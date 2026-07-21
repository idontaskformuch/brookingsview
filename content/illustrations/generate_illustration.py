"""Genererar en tecknad illustration per artikel (krönika/recension/recept).

Körs efter textgenerering + guardrails, innan commit. Leverantör/modell styrs helt av
config/image_model.py -- byte av IMAGE_MODEL eller IMAGE_API_PROVIDER kräver ingen
ändring här, bara i configen (och möjligen STYLE_PROMPT om modellbytet kräver en
annan promptformulering för samma visuella resultat).

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
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

from config.image_model import IMAGE_API_PROVIDER, IMAGE_MODEL, MODEL_IDS, STYLE_PROMPT

# Astro serverar bara statiska filer under site/public/ -- en bild sparad i
# repo-rotens assets/images/ (den ursprungliga platsen i CONTENT_MODULES.md) skulle
# aldrig bli nåbar på sajten. Sökvägen på sajten blir /assets/images/{slug}.png.
DEFAULT_OUT_DIR = Path("site/public/assets/images")
REQUEST_TIMEOUT = 60
REPLICATE_POLL_INTERVAL = 2
REPLICATE_MAX_POLLS = 60


def _model_id() -> str:
    key = (IMAGE_API_PROVIDER, IMAGE_MODEL)
    if key not in MODEL_IDS:
        raise ValueError(
            f"No model id configured for provider={IMAGE_API_PROVIDER!r} model={IMAGE_MODEL!r}. "
            f"Add it to MODEL_IDS in config/image_model.py."
        )
    return MODEL_IDS[key]


def _build_prompt(theme: str) -> str:
    return f"{STYLE_PROMPT}. Theme: {theme}"


def _generate_fal(model_id: str, prompt: str) -> bytes:
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY is not set -- required when IMAGE_API_PROVIDER='fal'.")

    resp = requests.post(
        f"https://fal.run/{model_id}",
        headers={"Authorization": f"Key {api_key}"},
        json={"prompt": prompt},
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
        json={"input": {"prompt": prompt}},
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


def _generate_or_raise(theme: str, slug: str, out_dir: Path) -> Path:
    generate = _PROVIDERS.get(IMAGE_API_PROVIDER)
    if generate is None:
        raise ValueError(f"Unknown IMAGE_API_PROVIDER: {IMAGE_API_PROVIDER!r}")
    model_id = _model_id()  # validate provider+model combo before touching any API key

    prompt = _build_prompt(theme)
    image_bytes = generate(model_id, prompt)

    # Providers don't all return PNG (fal.ai's flux/dev returns JPEG) -- re-encode so
    # the file on disk always matches its .png extension, regardless of provider.
    image = Image.open(BytesIO(image_bytes)).convert("RGB")

    out_path = out_dir / f"{slug}.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")
    return out_path


def generate_illustration(theme: str, slug: str, out_dir: Path = DEFAULT_OUT_DIR) -> Path | None:
    """Generate an illustration for `theme`, save it to out_dir/{slug}.png, return the path.

    Returns None on any failure (missing key, network/provider error, bad config)
    instead of raising -- callers should publish text-only rather than block.
    """
    try:
        return _generate_or_raise(theme, slug, out_dir)
    except Exception as exc:
        print(f"  [generate_illustration] failed, publishing without an image: {exc}")
        return None
