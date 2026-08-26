"""Modellval för artikel-illustrationer.

Byt IMAGE_MODEL/IMAGE_API_PROVIDER här för att testa en annan modell/leverantör --
generate_illustration.py läser bara denna config, ingen kodändring krävs vid byte.
STYLE_PROMPTS hålls separat så den kan justeras oberoende av modellvalet (t.ex. om ett
modellbyte kräver en annan promptformulering för samma visuella resultat).
"""
from __future__ import annotations

IMAGE_MODEL = "flux"          # "flux" | "sdxl"
IMAGE_API_PROVIDER = "fal"    # "fal" | "replicate" -- båda hostar flux och sdxl

# Minsta upplösning/bildförhållande Google Discover/News anger för hero-bilder
# (1200px bred, 16:9) -- se NEEDS-HUMAN-REVIEW.md "Image pipeline overhaul".
# 1600x900 ger marginal ovanför Googles angivna minimum i stället för att ligga
# exakt på det. Detta är den NATIVA illustrationens storlek, inte OG-kortets
# (som förblir 1200x630 -- ett separat, avsiktligt annorlunda beskuret socialt
# delningskort, se site/src/lib/og.ts).
IMAGE_WIDTH = 1600
IMAGE_HEIGHT = 900

# HÅRT VILLKOR, gäller alla stilprompter nedan oavsett innehållstyp -- aldrig
# riktiga, identifierbara personer, samma princip som gäller textinnehållet
# (se PLAN.md, permanenta guardrails). Bildstilen blev fotorealistisk 2026-08-25
# (Google Discover-vägledning favoriserar redaktionellt/fotorealistiskt
# bildspråk framför illustrerad stil, se samma NEEDS-HUMAN-REVIEW.md-avsnitt)
# -- det här villkoret är därför VIKTIGARE nu än när stilen var tecknad, inte
# mindre: en fotorealistisk bild av en påhittad "identifierbar" person skulle
# läsas som ett äkta foto på ett sätt en tecknad stil aldrig gjorde.
_NO_REAL_PEOPLE = "no real or identifiable people, no faces in sharp focus, no text, no logos, no watermarks"

# Per innehållstyp -- "fotorealistisk" läses olika för civic/kultur-text,
# recept och recensioner (se uppdragets egen "Likely needs per-content-type
# prompt templates" not). Nyckeln är content_type-strängen som redan finns i
# ai_pipeline/daily_content.py:s MODULES (culture_essay, editorial,
# kvick_essa, vetenskap_kronika, media_recension, vardagsmiddag) -- samma
# värden som redan styr allt annat innehållsspecifikt i den pipelinen, ingen
# ny klassificering att hålla i synk.
STYLE_PROMPTS: dict[str, str] = {
    "editorial": (
        "editorial photojournalism, natural available light, documentary "
        "reportage style, real-world small-town American setting, candid "
        "unposed composition, shallow depth of field, shot on a full-frame "
        "camera, muted natural color grade, no staged studio lighting"
    ),
    "culture_essay": (
        "editorial photojournalism, natural available light, documentary "
        "reportage style, real-world small-town American setting, candid "
        "unposed composition, shallow depth of field, shot on a full-frame "
        "camera, muted natural color grade, no staged studio lighting"
    ),
    "kvick_essa": (
        "editorial photojournalism, natural available light, documentary "
        "reportage style, real-world small-town American setting, candid "
        "unposed composition, shallow depth of field, shot on a full-frame "
        "camera, muted natural color grade, no staged studio lighting"
    ),
    "vetenskap_kronika": (
        "editorial photojournalism, natural available light, documentary "
        "reportage style, real-world small-town American setting, candid "
        "unposed composition, shallow depth of field, shot on a full-frame "
        "camera, muted natural color grade, no staged studio lighting"
    ),
    "media_recension": (
        "editorial photograph of the subject itself (the book, film still, "
        "dish, or venue being reviewed), natural light, real-world setting, "
        "shallow depth of field, magazine-review photography style, "
        "no staged studio lighting"
    ),
    "vardagsmiddag": (
        "natural light food photography, shallow depth of field, rustic "
        "wooden table setting, steam and texture visible, shot from a "
        "slight overhead angle, editorial food-magazine style, no staged "
        "studio lighting, no plastic-looking food styling"
    ),
}

# Fallback för ett innehållstyp-värde utan egen post ovan (t.ex. om en ny
# MODULES-post läggs till senare utan att uppdatera den här dicten) -- samma
# civic/dokumentär-baslinje som editorial/culture_essay, aldrig ett tomt
# promptfel som skulle stoppa publiceringen.
DEFAULT_STYLE_PROMPT = STYLE_PROMPTS["editorial"]

# (provider, model) -> modell-id hos respektive leverantör. Enda stället att röra vid
# ett riktigt modellbyte eller vid tillägg av en ny leverantör.
MODEL_IDS: dict[tuple[str, str], str] = {
    ("fal", "flux"): "fal-ai/flux/dev",
    ("fal", "sdxl"): "fal-ai/fast-sdxl",
    ("replicate", "flux"): "black-forest-labs/flux-dev",
    ("replicate", "sdxl"): "stability-ai/sdxl",
}
