"""Delad genereringshelper för Steg 3-innehållsmodulerna (krönikor/recensioner/recept).

Varje modul (culture_essay, editorial, ...) är tunn: sin egen SYSTEM_PROMPT-konstant + ett
anrop hit. Delat här: AI-anrop, budgettak (samma spårning som ai_pipeline.format_prompt,
så AI-spendering delar ett gemensamt tak oavsett om det går till nyhetsformatering eller
krönikor), style_filter.clean(), originality_check.is_original().

Byline-principen (se PLAN.md/CONTENT_MODULES.md): varje artikel ska kunna renderas med
en synlig "AI-genererad"-rad. Den byggs i to_metadata(), inte i AI-anropet.
"""
from __future__ import annotations

import datetime
import re
import sys
from dataclasses import dataclass

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

from ai_pipeline.format_prompt import (
    GenerationUnavailable, _record_spend, _spent_this_month, pricing_for, resolve_model, safe_create,
)
from ai_pipeline.town_guard import validate_town_identity
from guardrails.originality_check import is_original
from guardrails.style_filter import clean

# Kvar som den modell generate_article() faller tillbaka på när ingen
# content_type ges (eller när content_type saknas i CONTENT_TYPE_MODELS och
# cfg inte heller anger något) -- den faktiska per-typ-styrningen sker via
# resolve_model()/CONTENT_TYPE_MODELS i ai_pipeline/format_prompt.py, enda
# källan att ändra vid ett modellbyte.
DEFAULT_MODEL = "claude-sonnet-5"
# Svensk text kostar ~4 tokens/ord med den här modellens tokenizer (mätt: 701 ord =
# 2783 output-tokens), mot engelskans ~1.3. 900 ord (culture_essay, längsta målet) kan
# därför kosta ~3600 tokens redan innan icke-deterministisk variation räknas in --
# ett verkligt observerat fall (vetenskap_kronika, 2026-07-24) körde över 4096 och
# trunkerades tyst på en annars identisk prompt/underlag som lyckades fint vid
# omkörning. 6144 ger bredare marginal utan att på något sätt tvinga fram längre
# text. Trunkeringen hanteras ändå alltid (se stop_reason-kontrollen nedan) -- det
# här minskar bara hur ofta den triggas, det tar inte bort behovet av den.
DEFAULT_MAX_TOKENS = 6144

_OUTPUT_FORMAT_INSTRUCTION = (
    "\n\nOUTPUT FORMAT: return a single title line, then one blank line, then the "
    "article body. No markdown headers, no preamble, no other formatting.\n\n"
    "ALWAYS write the title and article in English, regardless of what language the "
    "instructions above happen to be written in -- the site itself is English-language, "
    "same as every other section of Brookings View. This applies even though the style "
    "guidance describes voices from non-English traditions (DN Kultur, NYT op-ed, etc.) "
    "-- borrow the VOICE, not the language."
)

_TITLE_BODY_SPLIT_RE = re.compile(r"\n\s*\n", re.MULTILINE)


@dataclass
class GeneratedArticle:
    title: str
    body: str
    # Endast media_recension sätter detta (se content/recensioner/media_recension.py).
    # None för alla andra modultyper -- inget att fylla i, inget att flagga.
    rating: float | None = None
    # Endast vardagsmiddag sätter detta (se content/recept/vardagsmiddag.py och
    # extract_marked_list() nedan). None för alla andra modultyper -- body
    # innehåller då som vanligt all text, ingen del bryts ut.
    ingredients: list[str] | None = None
    # Endast vardagsmiddag sätter detta, samma extract_marked_list()-mekanism
    # som ingredients men med en egen <<<INSTRUCTIONS>>>-markör. body innehåller
    # efter extraktion bara inledningen -- varken ingredienser eller
    # instruktioner ligger kvar som löptext.
    instructions: list[str] | None = None


_STATE_NAMES = {
    "SD": "South Dakota",
    "CA": "California",
    # lägg till fler här när fler delstater tillkommer
}


def town_label(cfg: dict | None) -> str:
    """Bygg strängen 'Ortsnamn, Delstat' från en orts config-dict.

    Central källa till ortsnamnet i prompts -- ingen kronika-modul ska mer
    hårdkoda en specifik ort. Expanderar delstatsförkortningen till fullt namn
    (configens 'state'-fält är bara "SD"/"CA" etc.) eftersom förkortningen läser
    sämre i en svenskspråkig prompt. Faller tillbaka snällt om cfg saknas/
    ofullständig eller delstaten inte finns i _STATE_NAMES, så en trasig eller
    ofullständig config ger ett vagt men ofarligt resultat, inte fel ort.
    """
    cfg = cfg or {}
    name = cfg.get("display_name")
    state_abbr = cfg.get("state")
    state = _STATE_NAMES.get(state_abbr, state_abbr)
    if name and state:
        return f"{name}, {state}"
    return name or "its coverage area"


def _split_title_body(text: str) -> tuple[str, str]:
    parts = _TITLE_BODY_SPLIT_RE.split(text.strip(), maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    # modellen följde inte formatet -- ta första raden som titel, resten som brödtext.
    lines = text.strip().split("\n", 1)
    return lines[0].strip(), (lines[1].strip() if len(lines) > 1 else "")


def generate_article(
    system_prompt: str,
    local_input: str,
    existing_corpus: list[str],
    cfg: dict | None = None,
    client=None,
    content_type: str | None = None,
    model: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> GeneratedArticle | None:
    """Generate one article: AI call -> style_filter.clean() -> originality_check.

    Model selection: an explicit `model=` always wins (kept for direct overrides/
    tests); otherwise resolved from `content_type` via
    ai_pipeline.format_prompt.CONTENT_TYPE_MODELS -- pass the module's own
    dispatch key (e.g. "editorial", "vardagsmiddag") so a model change for that
    content type only requires editing CONTENT_TYPE_MODELS, not this call site.

    Returns None if the monthly budget cap is hit, the anthropic package/client is
    unavailable, the API call itself fails (credit balance, rate limit, overload,
    connection -- see ai_pipeline.format_prompt.GenerationUnavailable), the result
    fails is_original(), or it fails the town-identity gate twice in a row (see
    ai_pipeline.town_guard) -- callers should log and skip publication for today
    rather than force out a weaker, duplicate, or wrong-town piece.
    """
    ai_cfg = (cfg or {}).get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return None

    if client is None:
        if anthropic is None:
            return None
        client = anthropic.Anthropic()

    resolved_model = model or resolve_model(content_type, cfg)
    price_in, price_out = pricing_for(resolved_model)

    def _call(extra_system: str = "") -> str | None:
        # GenerationUnavailable (API-fel) hanteras som VILKEN ANNAN anledning
        # att inte publicera i dag som helst -- returnera None, samma som
        # budgettak/saknat paket/misslyckad originalitetskoll. Se
        # GenerationUnavailable-docstringen för incidenten (2026-08-09) det
        # här skyddar mot.
        try:
            msg = safe_create(
                client,
                model=resolved_model,
                max_tokens=max_tokens,
                system=system_prompt + _OUTPUT_FORMAT_INSTRUCTION + extra_system,
                messages=[{"role": "user", "content": local_input}],
            )
        except GenerationUnavailable as exc:
            print(f"  AI-anrop misslyckades ({exc}) -- ingen artikel idag", file=sys.stderr)
            return None
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        # En text avkapad mitt i meningen är samma sorts fel som ett underkänt
        # originality_check: hellre ingen artikel idag än en trasig.
        if msg.stop_reason == "max_tokens":
            return None
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    text = _call()
    if text is None:
        return None
    title, body = _split_title_body(text)
    body = clean(body)
    title = clean(title)

    # Ort-identitetsspärren (se ai_pipeline/town_guard.py -- byggd efter
    # incidenten juli-augusti 2026 där flera modultyper hade "Brookings,
    # South Dakota" hårdkodat i SYSTEM_PROMPT och läckte fel orts identitet
    # in i den andra ortens publicerade text). PRE-PUBLISH: körs INNAN
    # is_original()/retur, inte som en efterhandskontroll -- en hård träff
    # innebär att utkastet aldrig publiceras. Ett omförsök med en uttrycklig
    # rättelse i prompten, samma mönster som guardrail-omförsöken i
    # ai_pipeline/sdsu_weekly_digest.py -- men till skillnad från de
    # strukturerade digestarna finns ingen vettig mall-fallback för en essä,
    # så ett andra misslyckande betyder "ingen artikel idag", inte en
    # urvattnad mall-text.
    town_id = (cfg or {}).get("town_id")
    if town_id:
        gate = validate_town_identity(f"{title}\n\n{body}", town_id)
        if not gate.passed:
            print(f"  ort-identitetsspärr ({', '.join(gate.violations)}) -- försöker igen en gång",
                  file=sys.stderr)
            retry_text = _call(
                "\n\nIMPORTANT CORRECTION: your previous draft incorrectly referenced "
                f"another town's identity. Rewrite it so every place reference, civic "
                f"detail, and address to the reader belongs ONLY to {town_label(cfg)} -- "
                "never any other city or state."
            )
            if retry_text is None:
                return None
            title, body = _split_title_body(retry_text)
            body = clean(body)
            title = clean(title)
            gate = validate_town_identity(f"{title}\n\n{body}", town_id)
            if not gate.passed:
                print(f"  ort-identitetsspärr kvarstår ({', '.join(gate.violations)}) "
                      "-- ingen artikel idag", file=sys.stderr)
                return None
        elif gate.reviews:
            # Granska-nivå (t.ex. "prairie") blockerar inte, men loggas så det
            # syns i körningsloggen om mönstret skulle bli vanligt.
            print(f"  ort-identitet: granska ({', '.join(gate.reviews)})", file=sys.stderr)

    if not is_original(body, existing_corpus):
        return None

    return GeneratedArticle(title=title, body=body)


_MARKED_BLOCK_RE_CACHE: dict[tuple[str, str], re.Pattern] = {}


def extract_marked_list(body: str, start_marker: str, end_marker: str) -> tuple[list[str], str]:
    """Pull a bullet-point block out of `body` and return (items, remaining_body).

    Modellen instrueras (se t.ex. vardagsmiddag.SYSTEM_PROMPT) att skriva en
    strukturerad lista mellan två markörrader, t.ex.:

        <<<INGREDIENTS>>>
        - 400 g kycklinglår, i bitar
        - 2 vitlöksklyftor, finhackade
        <<<END INGREDIENTS>>>

    Den här funktionen bryter ut raderna mellan markörerna som en lista
    (ledande "- " strippat), och tar bort hela blocket -- markörer inklusive --
    ur body, så att kvarvarande text (inledning + instruktioner) är oförändrad
    förklarande text, precis som innan listan bröts ut.

    Om markörerna saknas (modellen följde inte formatet) returneras en tom
    lista och body orörd -- samma fail-soft-princip som resten av modulen:
    hellre ostrukturerad text än en trasig sida.
    """
    key = (start_marker, end_marker)
    pattern = _MARKED_BLOCK_RE_CACHE.get(key)
    if pattern is None:
        pattern = re.compile(
            re.escape(start_marker) + r"\s*\n(.*?)\n\s*" + re.escape(end_marker),
            re.DOTALL,
        )
        _MARKED_BLOCK_RE_CACHE[key] = pattern

    match = pattern.search(body)
    if match is None:
        return [], body

    items = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("- "):
            line = line[2:].strip()
        elif line.startswith("-"):
            line = line[1:].strip()
        if line:
            items.append(line)

    remaining = (body[:match.start()] + body[match.end():])
    # Städa bort blankradsskräp som blocket kan lämna efter sig.
    remaining = re.sub(r"\n{3,}", "\n\n", remaining).strip()

    return items, remaining


def illustration_theme(article: GeneratedArticle, max_words: int = 40) -> str:
    """Title + a short thematic summary for generate_illustration().

    Flux-style image prompts work better short and concrete -- the full article
    body is too much (dilutes the prompt, costs more, and risks the model trying
    to render actual sentences as text in the image).
    """
    summary = " ".join(article.body.split()[:max_words])
    return f"{article.title}. {summary}"


def to_metadata(article: GeneratedArticle, category: str, slug: str,
                 image_path: str | None = None) -> dict:
    """Build the per-article metadata dict the site template renders (byline etc.)."""
    return {
        "title": article.title,
        "body": article.body,
        "category": category,
        "byline": "AI-genererad",
        "date": datetime.date.today().isoformat(),
        "slug": slug,
        "image": image_path or f"/assets/images/{slug}.png",
        "ingredients": article.ingredients,
        "instructions": article.instructions,
    }
