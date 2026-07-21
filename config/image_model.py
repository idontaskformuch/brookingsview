"""Modellval för artikel-illustrationer.

Byt IMAGE_MODEL/IMAGE_API_PROVIDER här för att testa en annan modell/leverantör --
generate_illustration.py läser bara denna config, ingen kodändring krävs vid byte.
STYLE_PROMPT hålls separat så den kan justeras oberoende av modellvalet (t.ex. om ett
modellbyte kräver en annan promptformulering för samma visuella resultat).
"""
from __future__ import annotations

IMAGE_MODEL = "flux"          # "flux" | "sdxl"
IMAGE_API_PROVIDER = "fal"    # "fal" | "replicate" -- båda hostar flux och sdxl

# Enhetlig visuell identitet över hela sajten: samma stilprompt oavsett artikel,
# med artikelns tema tillagt av generate_illustration.py. Inga riktiga, identifierbara
# personer -- samma princip som gäller textinnehållet (se PLAN.md, permanenta guardrails).
STYLE_PROMPT = (
    "editorial cartoon illustration, warm muted color palette, clean flat linework, "
    "consistent recurring visual style for a small-town newspaper, no text, no logos, "
    "no photorealistic faces, no depiction of real identifiable people"
)

# (provider, model) -> modell-id hos respektive leverantör. Enda stället att röra vid
# ett riktigt modellbyte eller vid tillägg av en ny leverantör.
MODEL_IDS: dict[tuple[str, str], str] = {
    ("fal", "flux"): "fal-ai/flux/dev",
    ("fal", "sdxl"): "fal-ai/fast-sdxl",
    ("replicate", "flux"): "black-forest-labs/flux-dev",
    ("replicate", "sdxl"): "stability-ai/sdxl",
}
