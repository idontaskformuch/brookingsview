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
    "university_digest": "claude-haiku-4-5-20251001",
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


def format_record(record: dict, source_type: str, cfg: dict,
                  client=None) -> FormatResult:
    """Formatera en post till publicerbar text, guardrail-validerad."""
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
    system = build_system_prompt(cfg)

    def _call(extra: str = "") -> tuple[str, object]:
        msg = safe_create(
            client,
            model=model, max_tokens=400, system=system + extra,
            messages=[{"role": "user",
                       "content": f"SOURCE DATA (source_type={source_type}):\n{source_text}"}],
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text"), msg.usage

    # GenerationUnavailable (API-fel: kreditsaldo, rate limit, överbelastning,
    # anslutning) hanteras EXAKT som ett guardrail-avslag -- mall-fallback,
    # aldrig en okontrollerad krasch. Se GenerationUnavailable-docstringen för
    # incidenten (2026-08-09) det här skyddar mot: utan detta kraschar hela
    # publish.py-processen på FÖRSTA raden som råkar formateras när kontot
    # saknar kredit, i stället för att bara falla tillbaka på mall för den
    # raden och fortsätta med resten av batchen.
    try:
        text, usage = _call()
        _record_spend(usage.input_tokens * price_in + usage.output_tokens * price_out)

        result = guardrails.validate(text, source_text, cfg)
        if not result.passed:
            # ett striktare omförsök
            strict = ("\n\nYour previous attempt included details not found in the source. "
                      "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
            text, usage = _call(strict)
            _record_spend(usage.input_tokens * price_in + usage.output_tokens * price_out)
            result = guardrails.validate(text, source_text, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall", file=sys.stderr)
        return _fallback(record, source_type, cfg, reason=f"AI ej tillgängligt: {exc}")

    if result.passed:
        return FormatResult(text=text, generated_by=f"ai:{model}", verified=True)

    # 4. gav sig inte → ren mall-fallback
    return _fallback(record, source_type, cfg,
                     reason=f"guardrail: {'; '.join(result.violations)}")


def _fallback(record: dict, source_type: str, cfg: dict, reason: str) -> FormatResult:
    templater = TEMPLATERS.get(source_type)
    if templater:
        return FormatResult(text=templater(record.get("payload", record), cfg),
                            generated_by="template_fallback", verified=True)
    # sista utväg: en minimal, säker faktarad
    title = record.get("title") or record.get("body") or record.get("description") or ""
    return FormatResult(text=str(title).strip(),
                        generated_by="template_fallback", verified=bool(title))
