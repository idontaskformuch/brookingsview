"""Generic Bonfire Night images from Pexels for the Glasgow review page (owner approved 2026-10-24).

Commons has no usable Glasgow Bonfire Night photos, so the owner allowed Pexels as a reserve for THAT group
only, and only generic fireworks and bonfire pictures: no identifiable places, no identifiable people. Pexels'
license (https://www.pexels.com/license/) is not on the Commons list (CC0 / PD / CC BY / CC BY-SA); this is the one
owner-approved exception, so every Pexels candidate carries its own source and license fields and the review page
labels it "via Pexels".

Hard filters on the photo's own description (alt text): anything naming a person or crowd, or a place, skyline or
landmark, is dropped; a weaker hint becomes a visible flag. The alt text cannot show everything, so the reviewer still
looks at each picture.

Merges into data/glasgow_image_candidates.json without touching the Commons candidates.

    python -m scripts.source_glasgow_pexels_images [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

OUT = Path(__file__).resolve().parent.parent / "data" / "glasgow_image_candidates.json"
API = "https://api.pexels.com/v1/search"
BUCKET = "holiday:bonfire_night"
PREFIX = "BON"
QUERIES = ["fireworks night sky", "fireworks display", "bonfire night", "bonfire flames night", "firework burst dark sky", "sparklers fireworks"]
MIN_WIDTH = 1600
MIN_ASPECT = 1.3
MAX_KEEP = 48  # Pexels does not rank for quality; the first 48 across the queries are plenty to choose from

HARD_PEOPLE = re.compile(
    r"\b(person|people|man|men|woman|women|girl|boy|child|children|kid|kids|couple|family|crowd|group|friends|"
    r"portrait|selfie|face|audience|spectators|silhouettes?|holding|watching|standing|walking|wearing|dancing)\b", re.I)
HARD_PLACE = re.compile(
    r"\b(city|skyline|cityscape|tower|bridge|building|buildings|castle|cathedral|church|london|paris|sydney|dubai|new york|"
    r"harbou?r|stadium|ferris|temple|palace|river|lake|sea|beach|mountain|street|town|village|park|pier|monument|"
    r"statue|eiffel|big ben|skyscraper|landmark|opera house)\b", re.I)
SOFT_PLACE = re.compile(r"\b(landscape|horizon|water|reflection|trees?|house|houses|roof)\b", re.I)


def evaluate(photo: dict) -> tuple[dict | None, str | None]:
    """-> (candidate fields, None) or (None, reject reason). Pure: no network."""
    w, h = int(photo.get("width") or 0), int(photo.get("height") or 0)
    if w < MIN_WIDTH or not h or w / h < MIN_ASPECT:
        return None, "size-or-aspect"
    alt = (photo.get("alt") or "").strip()
    if not alt:
        return None, "no-description"
    if HARD_PEOPLE.search(alt):
        return None, "people"
    if HARD_PLACE.search(alt):
        return None, "place"
    if not re.search(r"\b(fireworks?|bonfires?|flames?|sparklers?|firecrackers?|pyrotechnics?)\b", alt, re.I):
        return None, "not-fireworks-or-bonfire"
    photographer = (photo.get("photographer") or "").strip()
    if not photographer:
        return None, "no-photographer"
    src = photo.get("src") or {}
    flags = ["Pexels (not a Commons license)"]
    if SOFT_PLACE.search(alt):
        flags.append("place?")
    return {
        "source": "pexels",
        "title": f"pexels-{photo['id']}",
        "page_url": photo.get("url"),
        "thumb_url": src.get("large") or src.get("medium"),
        "thumb_w": 480, "thumb_h": round(480 * h / w),
        "width": w, "height": h,
        "artist": photographer,
        "license": "Pexels License",
        "license_url": "https://www.pexels.com/license/",
        "description": alt[:300],
        "categories": [],
        "taken": None,
        "flags": flags,
    }, None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise SystemExit("PEXELS_API_KEY missing")
    payload = json.loads(OUT.read_text(encoding="utf-8"))
    existing = {c["pageid"]: c for c in payload["candidates"] if c.get("source") == "pexels"}
    counter = max([int(c["id"].split("-")[1]) for c in existing.values()] or [0])

    session = requests.Session()
    session.headers["Authorization"] = key
    rejected: dict[str, int] = {}
    found: dict[int, dict] = {}
    for q in QUERIES:
        time.sleep(1.0)
        r = session.get(API, params={"query": q, "per_page": 40, "orientation": "landscape"}, timeout=30)
        r.raise_for_status()
        for photo in r.json().get("photos", []):
            pid = int(photo["id"])
            if pid in found:
                continue
            cand, reason = evaluate(photo)
            if cand is None:
                rejected[reason] = rejected.get(reason, 0) + 1
                continue
            if pid in existing:
                cid = existing[pid]["id"]
            else:
                counter += 1
                cid = f"{PREFIX}-{counter:03d}"
            found[pid] = {"id": cid, "pageid": pid, "buckets": [BUCKET], **cand}
        print(f"  {q!r}: {len(found)} candidates so far")

    kept = [c for c in payload["candidates"] if c.get("source") != "pexels"]
    chosen = list(found.values())[:MAX_KEEP]
    payload["candidates"] = sorted(kept + chosen, key=lambda c: c["id"])
    payload["pexels_rejected_by_reason"] = dict(sorted(rejected.items()))
    payload["license_policy"] = ("Commons: CC0, public domain, CC BY, CC BY-SA only; never NC or ND. "
                                 "Pexels: owner-approved exception for generic Bonfire Night fireworks and bonfires only")
    print(f"{len(chosen)} of {len(found)} Pexels candidates kept; rejected: {payload['pexels_rejected_by_reason']}")
    if not args.dry_run:
        OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
