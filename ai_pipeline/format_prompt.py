"""AI-formateringslager — gör rådata till varma, faktastrikta digests.

Hybridmodell (enligt PLAN):
  - Ren strukturerad data (väder, matchtider, priser) TEMPLATAS utan AI där det räcker.
  - AI väver ihop det som tjänar på kontext (möten, "vad byggs", veckans events).

Varje AI-genererad text passerar guardrails.validate(). Faller den → ett striktare
omförsök → annars fallback till ren mall. Vi publicerar hellre en torr men korrekt
rad än en påhittad uppgift.

Kostnad hålls nere med batchning + ett hårt månadsbudget-tak (ai.monthly_budget_usd).
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass

from ai_pipeline import guardrails

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None


class GenerationUnavailable(Exception):
    """AI-anropet kunde inte genomföras -- ett API-fel (kreditsaldo, rate
    limit, överbelastning, anslutning), inte ett kvalitets-/guardrail-avslag.

    Incident 2026-08-09 (~14:25-21:23 UTC): ett kreditsaldofel på Anthropic-
    kontot fick VARENDA scrape-and-publish-körning (båda orterna) att
    krascha okontrollerat i publish.py:s Stage 3-steg, eftersom inget
    anropsställe fångade client.messages.create()-fel -- felet propagerade
    rakt ut ur processen i stället för att falla tillbaka på mall som ett
    guardrail-avslag redan gjorde. Varje anropare ska fånga
    GenerationUnavailable och göra EXAKT samma sak som vid ett guardrail-
    avslag (falla tillbaka på mall/None, logga, fortsätt köra resten av
    batchen) -- aldrig låta den propagera."""


def safe_create(client, **kwargs):
    """client.messages.create(), men med ETT delat felfång i stället för att
    varje pipeline-modul (upptäckt: alla fem gjorde det) anropar Anthropic
    direkt utan try/except alls.

    Fångar anthropic.APIStatusError (täcker kreditsaldo, rate limit,
    överbelastning, auktorisering -- alla "API:et svarade men med ett fel"-
    varianter) och APIConnectionError (nätverket svarade inte alls), och gör
    om dem till GenerationUnavailable. Guardrail-/originalitetsavslag är INTE
    detta -- de är redan separat hanterade av respektive anropsställe och
    ska fortsätta vara det.
    """
    try:
        return client.messages.create(**kwargs)
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise GenerationUnavailable(str(exc)) from exc


# --- systemprompt byggd ur configen ----------------------------------------

def build_system_prompt(cfg: dict) -> str:
    ed = cfg.get("editorial", {})
    ai = cfg.get("ai", {})
    pos = cfg.get("positioning", {})
    never = "\n".join(f"- {x}" for x in ed.get("never_publish", []))
    tone = ai.get("tone_guidelines", "Warm, friendly, plain-language, strictly factual.")
    return f"""You write short local-news blurbs for {cfg['display_name']}, {cfg['state']}.
The site answers: "{pos.get('question_we_answer', "What's happening?")}" and must feel
{pos.get('feeling', 'positive and welcoming')}.

VOICE: {tone}

HARD RULES:
- ALWAYS write the blurb in English, regardless of what language the guidance
  above happens to be written in -- the site itself is English-language.
- Use ONLY facts present in the SOURCE DATA provided. Never invent names, numbers,
  dates, quotes, or details. If a detail is not in the source, do not state it.
- No opinion, no political framing, neutral on any contested civic matter.
- NEVER name an individual person. Not applicants, not residents who spoke, not
  staff, not officials. Refer to people by role instead: "an applicant in Preston
  Township", "the council", "a dispatcher", "the committee chair". Case and file
  numbers give readers traceability without naming anyone. Organizations,
  businesses, agencies, and place names are fine to name.
- Describe only attributes stated in the source. Do not add characterizations the
  source does not support -- not "family-friendly", not "a great way to spend an
  evening", not "good news". Report what it is; let the reader decide.
- Explain jargon and acronyms in plain words on first use, or avoid them. A reader
  who has never attended a meeting should understand every sentence.
- Lead with what affects residents. Give more space to decisions about housing,
  roads, taxes, safety, and access than to internal administration, merchandise, or
  scheduling. Not every agenda item deserves equal weight.
- Write dates in one consistent form: "July 23", never "July 23rd" or "7/23".
- Never write any of the following:
{never}
- Keep it short (2-5 sentences), concrete, and genuinely useful to a resident.

OPENINGS: these blurbs appear stacked by the dozen on one page, so any repeated
opening formula reads as machine-written. Do NOT open with a call to action or an
invitation of any kind -- not "Calling all X", not "Head to Y", not "Cool off with
Z", not "Grab your". Open with the concrete specific: what it is, when, where, who
it is for. Never use the phrase "mark your calendar".

Return ONLY the blurb text, no preamble, no markdown headers."""


# --- Summary Tone Prompts v2 (meeting/event/alert) --------------------------
#
# See NEEDS-HUMAN-REVIEW.md "Summary Tone Prompts -- scraped local items".
# Rewrites meeting/event/alert generation from one prose blob into
# {summary, meta} JSON, with per-type structure/length rules and shared
# voice/sentence-craft rules the plain build_system_prompt() above doesn't
# have. Gated behind cfg["ai"]["tone_v2"] (default off) in format_record()
# below -- kept until the side-by-side comparison in scripts/eval_tone_v2.py
# has actually been reviewed, per the brief's own §8. Does NOT touch the
# content track (editorial/culture_essay/...), which keeps using
# build_system_prompt() unchanged regardless of this flag.

TONE_V2_SHARED_RULES = """
VOICE
- Write for someone who already lives here. Do not explain where local
  landmarks are, and do not name the state or region inside the body text.
- Plain, concrete, unhurried. Short words over long ones.
- Third person. No first person, no "we", no "our city", no direct address
  to the reader ("you should", "be sure to").

SENTENCE CRAFT
- Vary opening structure. Do NOT open with the subject's name followed
  immediately by a verb of occurrence (e.g. "X meets at...", "The Council
  will hold...") in more than one sentence per item.
- Vary sentence length deliberately: include at least one short sentence
  (under ten words) where there is room.
- Concrete nouns over abstractions. Prefer numbers, sizes, streets, times.
- No empty lead-ins: "It is worth noting", "In an effort to", "As part of".

FORBIDDEN
- Evaluative adjectives and adverbs about the subject: long-awaited,
  controversial, exciting, important, significant, much-anticipated, key,
  major, popular, beloved, unique.
- Any claim of consequence, cause, motive, reaction or significance that is
  not stated in the source.
- Any sentence beginning "This means", "This comes as", "The move".
- Speculation about future outcomes beyond dates the source gives.
- Em dashes. Use commas, periods or parentheses.

REFERENCE DATA
Address, phone number, room number, registration details and cost do NOT
belong in the prose. Put them in the `meta` object instead (see the output
format below) -- never repeat them in `summary`.
"""

TONE_V2_TYPE_RULES: dict[str, str] = {
    "meeting": """
MEETING RULES -- length scales to substance, this is the main thing to get right:
- Routine agenda, nothing substantive: 1 sentence, then stop.
- One or two agenda items of consequence: 3-5 sentences.
- Major land-use, budget or ordinance items: up to 8 sentences.
- Open with the most consequential agenda item, not with the body's name and
  meeting time (those go in `meta.venue`/`meta.when`).
- Describe each substantive item in its own sentence, with the concrete
  detail the agenda gives: acreage, square footage, unit counts, street
  boundaries.
- Procedural facts that constrain the public (comment limits, speaker slips,
  where the packet is available) get one plain sentence at the end. State
  the limit; do not characterise it.
- Do not connect two agenda items into a pattern, note what a decision
  "could affect", or describe anything as contested -- that is editorial
  work, not this pipeline's job.
""",
    "event": """
EVENT RULES -- two to four sentences, hard ceiling of four:
- Open with what actually happens at the event, not its name and
  meeting-place (those go in `meta.venue`/`meta.when`).
  Before: "Dragons in the Stacks runs August 25 at the Moreno Valley Public
  Library Mall Branch, 22500 Town Circle, Suite 2078."
  Wanted shape: "Tabletop role-playing, adults welcome, dice provided. The
  Mall branch runs it monthly."
- State the intended audience (age range, adults, teens, preschool) early --
  it is the fact that decides relevance to a reader.
- Recurring events: state the cadence ("Every Tuesday at six") rather than
  only the single instance date.
- If the source description is thin, write two sentences. Do not invent
  atmosphere, and do not describe what attendees will feel or gain.
- Never write "for more information, call..." in the prose -- that is
  `meta.phone`.
""",
    "alert": """
ALERT RULES -- flatness is a feature here, keep tone changes minimal:
- Lead with the practical shape: what, where, how long. Not the issuing body.
- Keep official safety guidance close to the source wording. Do not
  paraphrase it for style, and do not compress a list of precautions into a
  summary clause -- state each precaution its own sentence.
- Geographic scope must be explicit in the first sentence -- a regional
  alert covering neighboring areas must name which areas.
- No reassurance, no alarm, no advice beyond what the source issues.
- Two to four sentences normally; up to seven when the source gives a
  genuine multi-item precaution list -- length follows the precaution
  count, it is never padded.
""",
}

# Post-generation length ceiling per type (guardrails.validate_tone_v2()) --
# meeting's scaling (1-8 sentences, by substance) means only the outer
# ceiling is checkable mechanically; the "does it actually scale down for a
# routine meeting" judgment is a prompt-quality question, not a guardrail.
TONE_V2_MAX_SENTENCES: dict[str, int] = {"meeting": 8, "event": 4, "alert": 7}


def build_system_prompt_v2(cfg: dict, source_type: str) -> str:
    type_rules = TONE_V2_TYPE_RULES.get(source_type, "")
    return f"""You write short local-news items for {cfg['display_name']}, {cfg['state']}.

HARD RULES (fact/safety, unconditional):
- ALWAYS write in English, regardless of what language any guidance here is
  written in -- the site itself is English-language.
- Use ONLY facts present in the SOURCE DATA provided. Never invent names,
  numbers, dates, quotes, or details. If a detail is not in the source, do
  not state it.
- No opinion, no political framing, neutral on any contested civic matter.
- NEVER name an individual person. Refer to people by role instead ("an
  applicant in Preston Township", "the council", "a dispatcher"). Case and
  file numbers give traceability without naming anyone. Organizations,
  businesses, agencies, and place names are fine to name.
- Explain jargon and acronyms in plain words on first use, or avoid them.
- Write dates in one consistent form: "July 23", never "July 23rd" or "7/23".
{TONE_V2_SHARED_RULES}
{type_rules}
OUTPUT FORMAT -- return ONLY a single JSON object, no markdown fences, no
preamble, matching exactly this shape (omit a `meta` key entirely if it has
no real value, never emit an empty string):
{{"summary": "...", "meta": {{"venue": "...", "address": "...", "phone": "...",
"when": "...", "recurrence": "...", "audience": "...", "cost": "...",
"registration": "..."}}}}"""


def parse_tone_v2_response(raw: str) -> tuple[str, dict] | None:
    """Parses the model's {summary, meta} JSON. Returns None (never raises)
    on anything malformed -- format_record() below treats that exactly like
    a guardrail rejection: a strict retry, then template fallback. A
    response that ignored the JSON-only instruction is a generation-quality
    failure, not a code bug worth crashing the batch over."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict) or not isinstance(obj.get("summary"), str) or not obj["summary"].strip():
        return None
    meta = obj.get("meta")
    if meta is not None and not isinstance(meta, dict):
        return None
    # Omit empty-string values silently (§6: "Omit empty fields silently") --
    # normalize here once so every caller/template can just check truthiness.
    meta = {k: v for k, v in (meta or {}).items() if v not in (None, "")}
    return obj["summary"].strip(), meta


# --- template-fallbacks (ingen AI) -----------------------------------------

def template_weather(payload: dict, cfg: dict) -> str:
    periods = payload.get("periods", [])
    if not periods:
        return ""
    p = periods[0]
    return (f"{p.get('name','Today')} in {cfg['display_name']}: {p.get('short','')}, "
            f"around {p.get('temp')}°{p.get('unit','F')}. Wind {p.get('wind','')}.").strip()


def template_sports(rec: dict, cfg: dict) -> str:
    when = rec.get("starts_at", "")
    opp = rec.get("opponent", "their opponent")
    ha = "at home" if rec.get("home_away") == "home" else "on the road"
    base = f"The SDSU Jackrabbits ({rec.get('sport','')}) play {opp} {ha}"
    if rec.get("venue"):
        base += f" at {rec['venue']}"
    if when:
        base += f" on {when}"
    if rec.get("result"):
        base += f". Final: {rec['result']}"
    return base + "."


def template_ag(rec: dict, cfg: dict) -> str:
    return (f"{rec.get('commodity','').title()} price: "
            f"{rec.get('price')} {rec.get('unit','')} (source: USDA NASS).").strip()


TEMPLATERS = {
    "weather": template_weather,
    "sports": template_sports,
    "ag": template_ag,
}


# --- modellval per content-typ -----------------------------------------------
#
# Central, enda källan till "vilken modell skriver den här content-typen" --
# ändra HÄR för att flytta en typ mellan Haiku/Sonnet, inget annat ställe
# behöver röras. content/_base.py:s generate_article() och de tre
# ai_pipeline-skripten (format_prompt/home_sales_digest/weekly) läser alla
# härifrån via resolve_model().
#
# Innan detta fanns lästes modellen från cfg["ai"]["model"] (configs/*.json)
# i de tre ai_pipeline-skripten, men de sex content/-modulerna (kronikor,
# recension, recept) ignorerade configen helt och körde alltid DEFAULT_MODEL
# nedan -- så per-typ-styrning fanns i praktiken inte. resolve_model() nedan
# är nu den enda vägen in, och faller tillbaka till cfg["ai"]["model"] och
# sedan DEFAULT_MODEL för typer som inte finns i dicten.
#
# Uppdelning 2026-08-10 (kostnadssänkning): strukturerad/extraktiv text
# (recept, home-sales-digest, veckodigest, möten/event/varningar-formatering)
# på Haiku -- lägre kostnad, och kvalitetskravet är "korrekt och tydlig", inte
# "en distinkt röst". Tolkande/kreativ text (ledare, kulturessä, vetenskap,
# kåseri, recension) kvar på Sonnet -- kåseriet är om något MER känsligt för
# modellkvalitet än vetenskapskrönikan (ordlekar som inte landar är sämre än
# neutral text), och en recension bygger på samma trovärdiga-röst-krav som en
# ledare.
CONTENT_TYPE_MODELS: dict[str, str] = {
    # Haiku -- strukturerad/extraktiv, hög volym, lägre kreativitetskrav
    "vardagsmiddag": "claude-haiku-4-5-20251001",
    "home_sales_digest": "claude-haiku-4-5-20251001",
    "sports_digest": "claude-haiku-4-5-20251001",
    "jackrabbits_season_summary": "claude-haiku-4-5-20251001",
    "university_digest": "claude-haiku-4-5-20251001",
    "workplace_watch_digest": "claude-haiku-4-5-20251001",
    "weekly": "claude-haiku-4-5-20251001",
    "meeting": "claude-haiku-4-5-20251001",
    "event": "claude-haiku-4-5-20251001",
    "alert": "claude-haiku-4-5-20251001",
    # Sonnet -- tolkande/kreativ text, röst- och kvalitetskänslig
    "editorial": "claude-sonnet-5",
    "culture_essay": "claude-sonnet-5",
    "vetenskap_kronika": "claude-sonnet-5",
    "kvick_essa": "claude-sonnet-5",
    "media_recension": "claude-sonnet-5",
}

DEFAULT_MODEL = "claude-sonnet-5"


def resolve_model(content_type: str | None, cfg: dict | None = None) -> str:
    """Vilken modell en given content-typ ska skriva med.

    Ordning: CONTENT_TYPE_MODELS (explicit per-typ-styrning) -> cfg["ai"]["model"]
    (stadens egen configinställning, om satt) -> DEFAULT_MODEL. En config med
    en avvikande modell vinner ALDRIG över en explicit CONTENT_TYPE_MODELS-post
    -- den senare är ett medvetet kostnads-/kvalitetsval per innehållstyp,
    inte något en stads config ska kunna råka skriva över.
    """
    if content_type and content_type in CONTENT_TYPE_MODELS:
        return CONTENT_TYPE_MODELS[content_type]
    return (cfg or {}).get("ai", {}).get("model", DEFAULT_MODEL)


# USD per token, per modell -- håller budgetspårningen (_record_spend nedan)
# korrekt oavsett vilken modell en viss körning faktiskt använde. Innan detta
# antog varje _record_spend-anrop Sonnets pris rakt av, vilket hade fått
# Haiku-körningar att se dyrare ut i spårningen än de faktiskt är -- och
# därmed underminerat hela poängen med att flytta billig content dit.
# Prislistan är Anthropics publika per 2026-08 -- kontrollera mot
# anthropic.com/pricing om den ändras.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-5": (3.0 / 1_000_000, 15.0 / 1_000_000),
    "claude-haiku-4-5-20251001": (1.0 / 1_000_000, 5.0 / 1_000_000),
}


def pricing_for(model: str) -> tuple[float, float]:
    """(usd_per_input_token, usd_per_output_token) för en given modell.

    Okänd modell -> Sonnets pris (säkert att överskatta kostnad, aldrig
    underskatta den mot det faktiska budgettaket)."""
    return MODEL_PRICING.get(model, MODEL_PRICING["claude-sonnet-5"])


_BUDGET_FILE = os.environ.get("AI_BUDGET_STATE", ".ai_budget.json")
# Sonnets pris specifikt -- kvar för bakåtkompatibilitet (flera moduler
# importerar dessa två namn direkt). Ny kod ska använda pricing_for(model)
# ovan i stället, som ger rätt pris oavsett modell.
_USD_PER_INPUT_TOKEN = 3.0 / 1_000_000
_USD_PER_OUTPUT_TOKEN = 15.0 / 1_000_000


def _spent_this_month() -> float:
    try:
        with open(_BUDGET_FILE) as f:
            data = json.load(f)
        from datetime import date
        if data.get("month") == date.today().strftime("%Y-%m"):
            return float(data.get("spent", 0.0))
    except (FileNotFoundError, ValueError):
        pass
    return 0.0


def _record_spend(usd: float) -> None:
    from datetime import date
    month = date.today().strftime("%Y-%m")
    spent = _spent_this_month() + usd
    with open(_BUDGET_FILE, "w") as f:
        json.dump({"month": month, "spent": spent}, f)


# --- huvud-API --------------------------------------------------------------

@dataclass
class FormatResult:
    text: str
    generated_by: str      # "ai:<model>" | "template" | "template_fallback"
    verified: bool
    # Only ever set on the tone_v2 path (meeting/event/alert, cfg["ai"]["tone_v2"]
    # true) -- see NEEDS-HUMAN-REVIEW.md "Summary Tone Prompts". None for every
    # other path, including the old prose-blob generator for the same types.
    meta: dict | None = None


# Field names actually used across meetings/events rows for "does the
# source have a venue/when at all" (guardrails.validate_tone_v2()'s required-
# field check, §7.1). Kept as a plain tuple, not a schema -- this only needs
# to answer "is there something here", not parse the value.
_VENUE_FIELDS = ("venue", "location", "Location")
_WHEN_FIELDS = ("meeting_date", "starts_at", "occurs_at")


def _source_has_venue(record: dict) -> bool:
    return any(record.get(f) for f in _VENUE_FIELDS)


def _source_has_when(record: dict) -> bool:
    return any(record.get(f) for f in _WHEN_FIELDS)


def format_record(record: dict, source_type: str, cfg: dict,
                  client=None, recent_openings: list[str] | None = None) -> FormatResult:
    """Formatera en post till publicerbar text, guardrail-validerad.

    `recent_openings`: only meaningful for the tone_v2 path -- the caller's
    proxy for "what's rendered on one page" for the opening-structure
    diversity check (guardrails.classify_opening()/opening_diversity_ok()).
    See ai_pipeline/publish.py for how it's built. Ignored otherwise.
    """
    ai_cfg = cfg.get("ai", {})

    # 1. ren strukturerad data → mall, ingen AI
    if source_type in TEMPLATERS and source_type in ("weather", "sports", "ag"):
        text = TEMPLATERS[source_type](record.get("payload", record), cfg)
        return FormatResult(text=text, generated_by="template", verified=True)

    # 2. budgettak
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return _fallback(record, source_type, cfg, reason="budget cap nådd")

    # 3. AI-formatering. En explicit `client` (t.ex. i tester) ska funka även om
    # `anthropic`-paketet inte gick att importera i den här processen -- annars är
    # dependency injection-parametern death on arrival så fort paketet saknas.
    if client is None:
        if anthropic is None:
            return _fallback(record, source_type, cfg, reason="anthropic-paket saknas")
        client = anthropic.Anthropic()  # läser ANTHROPIC_API_KEY

    model = resolve_model(source_type, cfg)
    price_in, price_out = pricing_for(model)
    source_text = guardrails.source_to_text(record)

    tone_v2 = bool(ai_cfg.get("tone_v2")) and source_type in TONE_V2_TYPE_RULES
    system = build_system_prompt_v2(cfg, source_type) if tone_v2 else build_system_prompt(cfg)

    def _call(extra: str = "") -> tuple[str, object]:
        msg = safe_create(
            client,
            model=model, max_tokens=500 if tone_v2 else 400, system=system + extra,
            messages=[{"role": "user",
                       "content": f"SOURCE DATA (source_type={source_type}):\n{source_text}"}],
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text"), msg.usage

    def _validate(raw_text: str) -> tuple[bool, list[str], str, dict | None]:
        """Returns (passed, violations, summary_text, meta). For tone_v2,
        malformed JSON is treated exactly like a guardrail rejection (see
        parse_tone_v2_response()'s own docstring) -- never raises."""
        if not tone_v2:
            result = guardrails.validate(raw_text, source_text, cfg)
            return result.passed, result.violations, raw_text, None

        parsed = parse_tone_v2_response(raw_text)
        if parsed is None:
            return False, ["tone_v2: response was not valid {summary, meta} JSON"], raw_text, None
        summary, meta = parsed
        fact_result = guardrails.validate(summary, source_text, cfg)
        tone_result = guardrails.validate_tone_v2(
            summary, meta, source_text, source_type, cfg,
            has_venue_in_source=_source_has_venue(record),
            has_when_in_source=_source_has_when(record),
            recent_openings=recent_openings,
        )
        violations = fact_result.violations + tone_result.violations
        return not violations, violations, summary, meta

    # GenerationUnavailable (API-fel: kreditsaldo, rate limit, överbelastning,
    # anslutning) hanteras EXAKT som ett guardrail-avslag -- mall-fallback,
    # aldrig en okontrollerad krasch. Se GenerationUnavailable-docstringen för
    # incidenten (2026-08-09) det här skyddar mot: utan detta kraschar hela
    # publish.py-processen på FÖRSTA raden som råkar formateras när kontot
    # saknar kredit, i stället för att bara falla tillbaka på mall för den
    # raden och fortsätta med resten av batchen.
    try:
        raw, usage = _call()
        _record_spend(usage.input_tokens * price_in + usage.output_tokens * price_out)
        passed, violations, text, meta = _validate(raw)

        if not passed:
            # ett striktare omförsök -- måste peka på VAD som faktiskt underkändes.
            # Tidigare var det här meddelandet ett hårdkodat "du hittade på fakta"
            # oavsett verklig avslagsorsak. Live-testat (2026-08-26,
            # scripts/eval_tone_v2.py mot Moreno Valley): tone_v2:s meta.when-krav
            # (§7.1) slog till på 6 av 10 möten, men det generiska meddelandet gav
            # modellen noll signal om VAD som saknades -- omförsöket upprepade
            # samma miss, och möten utan egen TEMPLATERS-mall föll då rakt igenom
            # till _fallback()'s sista utväg (bara styrelsens namn, ingen substans
            # alls). Peka på de faktiska violations i stället.
            strict = (
                "\n\nYour previous attempt was rejected for these specific reasons:\n"
                + "\n".join(f"- {v}" for v in violations)
                + "\nFix exactly these issues. Do not otherwise change what you wrote."
            )
            raw, usage = _call(strict)
            _record_spend(usage.input_tokens * price_in + usage.output_tokens * price_out)
            passed, violations, text, meta = _validate(raw)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall", file=sys.stderr)
        return _fallback(record, source_type, cfg, reason=f"AI ej tillgängligt: {exc}")

    if passed:
        return FormatResult(text=text, generated_by=f"ai:{model}", verified=True, meta=meta)

    # 4. gav sig inte → ren mall-fallback
    return _fallback(record, source_type, cfg,
                     reason=f"guardrail: {'; '.join(violations)}")


def _fallback(record: dict, source_type: str, cfg: dict, reason: str) -> FormatResult:
    templater = TEMPLATERS.get(source_type)
    if templater:
        return FormatResult(text=templater(record.get("payload", record), cfg),
                            generated_by="template_fallback", verified=True)
    # sista utväg: en minimal, säker faktarad
    title = record.get("title") or record.get("body") or record.get("description") or ""
    return FormatResult(text=str(title).strip(),
                        generated_by="template_fallback", verified=bool(title))
