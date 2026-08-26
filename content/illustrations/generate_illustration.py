"""Genererar en redaktionell/fotorealistisk illustration per artikel
(krönika/recension/recept).

Körs efter textgenerering + guardrails, innan commit. Leverantör/modell styrs helt av
config/image_model.py -- byte av IMAGE_MODEL eller IMAGE_API_PROVIDER kräver ingen
ändring här, bara i configen (och möjligen STYLE_PROMPTS om modellbytet kräver en
annan promptformulering för samma visuella resultat).

Genererar EN nativ bild (1600x900, 16:9 -- se IMAGE_WIDTH/IMAGE_HEIGHT i configen)
och beskär den lokalt (Pillow, ingen extra API-kostnad) till två ytterligare
varianter för strukturerad data (NewsArticle image[], se NEEDS-HUMAN-REVIEW.md
"Image pipeline overhaul"):
  {slug}.png       nativ, 1600x900, 16:9 -- oförändrad sökvägskonvention
  {slug}-4x3.png   center-beskuren, 1200x900, 4:3
  {slug}-1x1.png   center-beskuren, 900x900, 1:1
Alla tre delar samma källbild -- ingen ny genereringskostnad för de två extra
varianterna, bara lokal bildbehandling.

Bilden är inte guardrail-kritisk som text/originalitet -- en misslyckad
bildgenerering (saknad API-nyckel, nätverksfel, leverantörsfel) ska aldrig blockera
en i övrigt godkänd artikel. generate_illustration() returnerar därför None vid
fel, samma failure-as-null-konvention som content._base.generate_article(), i
stället för att kasta. Felet skrivs ut (till skillnad från guardrails, som är
tysta vid avslag) så ett ihållande konfigurationsfel ändå syns i Actions-loggen
även om det aldrig blockerar publiceringen.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

from config.image_model import (
    DEFAULT_STYLE_PROMPT, IMAGE_API_PROVIDER, IMAGE_HEIGHT, IMAGE_MODEL, IMAGE_WIDTH,
    MODEL_IDS, STYLE_PROMPTS, _NO_REAL_PEOPLE,
)

# Astro serverar bara statiska filer under site/public/ -- en bild sparad i
# repo-rotens assets/images/ (den ursprungliga platsen i CONTENT_MODULES.md) skulle
# aldrig bli nåbar på sajten. Sökvägen på sajten blir /assets/images/{slug}.png.
DEFAULT_OUT_DIR = Path("site/public/assets/images")
REQUEST_TIMEOUT = 60
REPLICATE_POLL_INTERVAL = 2
REPLICATE_MAX_POLLS = 60


@dataclass
class GeneratedImages:
    """Paths for the three crop variants -- all guaranteed to exist together
    (they're all cropped from the same successfully-generated native image)."""
    native: Path       # {slug}.png, 1600x900, 16:9
    crop_4x3: Path      # {slug}-4x3.png, 1200x900
    crop_1x1: Path      # {slug}-1x1.png, 900x900


def _model_id() -> str:
    key = (IMAGE_API_PROVIDER, IMAGE_MODEL)
    if key not in MODEL_IDS:
        raise ValueError(
            f"No model id configured for provider={IMAGE_API_PROVIDER!r} model={IMAGE_MODEL!r}. "
            f"Add it to MODEL_IDS in config/image_model.py."
        )
    return MODEL_IDS[key]


def _build_prompt(theme: str, content_type: str | None) -> str:
    style = STYLE_PROMPTS.get(content_type, DEFAULT_STYLE_PROMPT) if content_type else DEFAULT_STYLE_PROMPT
    return f"{style}, {_NO_REAL_PEOPLE}. Theme: {theme}"


def _generate_fal(model_id: str, prompt: str) -> bytes:
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY is not set -- required when IMAGE_API_PROVIDER='fal'.")

    resp = requests.post(
        f"https://fal.run/{model_id}",
        headers={"Authorization": f"Key {api_key}"},
        # image_size: {width, height} is fal.ai's documented custom-size shape
        # (verified live against fal.ai/models/fal-ai/flux/dev/api on
        # 2026-08-25 -- the enum presets like "landscape_16_9" don't hit our
        # exact 1600x900 target, see IMAGE_WIDTH/IMAGE_HEIGHT in the config).
        json={"prompt": prompt, "image_size": {"width": IMAGE_WIDTH, "height": IMAGE_HEIGHT}},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    images = data.get("images") or []
    if not images:
        raise RuntimeError(f"fal.ai response had no images: {data}")
    image_url = images[0]["url"]

    image_resp = requests.get(image_url, timeout=REQUEST_TIMEOUT)
    image_resp.raise_for_status()
    return image_resp.content


def _generate_replicate(model_id: str, prompt: str) -> bytes:
    api_token = os.environ.get("REPLICATE_API_TOKEN")
    if not api_token:
        raise RuntimeError("REPLICATE_API_TOKEN is not set -- required when IMAGE_API_PROVIDER='replicate'.")

    headers = {"Authorization": f"Token {api_token}"}
    resp = requests.post(
        "https://api.replicate.com/v1/models/" + model_id + "/predictions",
        headers=headers,
        # width/height: NOT independently verified live against Replicate's
        # own current schema for this exact model (its docs page is a JS app
        # that doesn't expose parameters to a plain fetch, and the REST API's
        # schema endpoint requires an API token this environment doesn't
        # have) -- this is the standard shape across most Replicate SD/Flux
        # wrappers, but "replicate" is NOT the active IMAGE_API_PROVIDER
        # (config/image_model.py has "fal"), so this path is currently
        # unused. Spot-check this against a real prediction before ever
        # switching IMAGE_API_PROVIDER to "replicate".
        json={"input": {"prompt": prompt, "width": IMAGE_WIDTH, "height": IMAGE_HEIGHT}},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    prediction = resp.json()

    get_url = prediction["urls"]["get"]
    for _ in range(REPLICATE_MAX_POLLS):
        status_resp = requests.get(get_url, headers=headers, timeout=REQUEST_TIMEOUT)
        status_resp.raise_for_status()
        prediction = status_resp.json()
        if prediction["status"] == "succeeded":
            break
        if prediction["status"] in ("failed", "canceled"):
            raise RuntimeError(f"Replicate prediction {prediction['status']}: {prediction.get('error')}")
        time.sleep(REPLICATE_POLL_INTERVAL)
    else:
        raise RuntimeError("Replicate prediction did not finish in time.")

    output = prediction["output"]
    image_url = output[0] if isinstance(output, list) else output

    image_resp = requests.get(image_url, timeout=REQUEST_TIMEOUT)
    image_resp.raise_for_status()
    return image_resp.content


_PROVIDERS = {
    "fal": _generate_fal,
    "replicate": _generate_replicate,
}


def _center_crop(image: Image.Image, target_ratio: float) -> Image.Image:
    """Crops `image` to `target_ratio` (width/height), centered, without
    upscaling -- shrinks whichever dimension is "too wide" for the target
    ratio. The native image is always wider (16:9) than either crop target
    (4:3, 1:1) here, so this only ever trims width, never height."""
    width, height = image.size
    current_ratio = width / height
    if current_ratio > target_ratio:
        new_width = round(height * target_ratio)
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    new_height = round(width / target_ratio)
    top = (height - new_height) // 2
    return image.crop((0, top, width, top + new_height))


def _generate_or_raise(theme: str, slug: str, out_dir: Path, content_type: str | None) -> GeneratedImages:
    generate = _PROVIDERS.get(IMAGE_API_PROVIDER)
    if generate is None:
        raise ValueError(f"Unknown IMAGE_API_PROVIDER: {IMAGE_API_PROVIDER!r}")
    model_id = _model_id()  # validate provider+model combo before touching any API key

    prompt = _build_prompt(theme, content_type)
    image_bytes = generate(model_id, prompt)

    # Providers don't all return PNG (fal.ai's flux/dev returns JPEG) -- re-encode so
    # the file on disk always matches its .png extension, regardless of provider.
    image = Image.open(BytesIO(image_bytes)).convert("RGB")

    out_dir.mkdir(parents=True, exist_ok=True)
    native_path = out_dir / f"{slug}.png"
    image.save(native_path, format="PNG")

    # Three crops from the SAME generated image, not three separate API calls
    # -- see this module's docstring for the storage/naming convention.
    crop_4x3_path = out_dir / f"{slug}-4x3.png"
    _center_crop(image, 4 / 3).save(crop_4x3_path, format="PNG")

    crop_1x1_path = out_dir / f"{slug}-1x1.png"
    _center_crop(image, 1 / 1).save(crop_1x1_path, format="PNG")

    return GeneratedImages(native=native_path, crop_4x3=crop_4x3_path, crop_1x1=crop_1x1_path)


def generate_illustration(
    theme: str, slug: str, out_dir: Path = DEFAULT_OUT_DIR, content_type: str | None = None,
) -> GeneratedImages | None:
    """Generate an illustration for `theme`, save the native 16:9 image plus
    4:3 and 1:1 crops to out_dir, return their paths.

    `content_type` selects the style prompt (STYLE_PROMPTS in
    config/image_model.py) -- e.g. "vardagsmiddag" for food photography vs.
    "editorial" for documentary photojournalism. Falls back to a civic/
    documentary default style if omitted or unrecognized, never a hard error.

    Returns None on any failure (missing key, network/provider error, bad config)
    instead of raising -- callers should publish text-only rather than block.
    """
    try:
        return _generate_or_raise(theme, slug, out_dir, content_type)
    except Exception as exc:
        print(f"  [generate_illustration] failed, publishing without an image: {exc}")
        return None
