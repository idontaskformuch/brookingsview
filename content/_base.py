"""Delad genereringshelper för Steg 3-innehållsmodulerna (krönikor/recensioner/recept).

Varje modul (kultur_essa, ledare, ...) är tunn: sin egen SYSTEM_PROMPT-konstant + ett
anrop hit. Delat här: AI-anrop, budgettak (samma spårning som ai_pipeline.format_prompt,
så AI-spendering delar ett gemensamt tak oavsett om det går till nyhetsformatering eller
krönikor), style_filter.clean(), originality_check.is_original().

Byline-principen (se PLAN.md/CONTENT_MODULES.md): varje artikel ska kunna renderas med
en synlig "AI-genererad"-rad. Den byggs i to_metadata(), inte i AI-anropet.
"""
from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

from ai_pipeline.format_prompt import _record_spend, _spent_this_month, _USD_PER_INPUT_TOKEN, _USD_PER_OUTPUT_TOKEN
from guardrails.originality_check import is_original
from guardrails.style_filter import clean

DEFAULT_MODEL = "claude-sonnet-5"
# Svensk text kostar ~4 tokens/ord med den här modellens tokenizer (mätt: 701 ord =
# 2783 output-tokens), mot engelskans ~1.3. 900 ord (kultur_essa, längsta målet) kan
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
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> GeneratedArticle | None:
    """Generate one article: AI call -> style_filter.clean() -> originality_check.

    Returns None if the monthly budget cap is hit, the anthropic package/client is
    unavailable, or the result fails is_original() -- callers should log and skip
    publication for today rather than force out a weaker or duplicate piece.
    """
    ai_cfg = (cfg or {}).get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return None

    if client is None:
        if anthropic is None:
            return None
        client = anthropic.Anthropic()

    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt + _OUTPUT_FORMAT_INSTRUCTION,
        messages=[{"role": "user", "content": local_input}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    _record_spend(msg.usage.input_tokens * _USD_PER_INPUT_TOKEN
                  + msg.usage.output_tokens * _USD_PER_OUTPUT_TOKEN)

    # En text avkapad mitt i meningen är samma sorts fel som ett underkänt
    # originality_check: hellre ingen artikel idag än en trasig.
    if msg.stop_reason == "max_tokens":
        return None

    title, body = _split_title_body(text)
    body = clean(body)
    title = clean(title)

    if not is_original(body, existing_corpus):
        return None

    return GeneratedArticle(title=title, body=body)


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
    }
