"""Activate APPROVED Glasgow images (owner approves ids on /qa/images/ in batches, 2026-10-24).

Takes candidate ids from data/glasgow_image_candidates.json, downloads each file (Wikimedia Commons: a 1600 px
rendition via Special:FilePath; Pexels: the large2x file via the API), center-crops to 3:2 and saves a 1200x800 JPEG
under site/public/assets/images/{this-week|holidays}/, then appends the pool entries (with attribution: photographer,
license, link to the source page) to site/src/config/gb/glasgow-images.ts (spread into the shared pools).

The destination follows the candidate's bucket: season:autumn / season:winter -> this-week pool; holiday:* -> holiday
pool. Category-image buckets (category:*) are not handled here: they need a decision about which section uses them.

    python -m scripts.activate_glasgow_images --ids "AUT-001, AUT-003"            # dry run: prints what would happen
    python -m scripts.activate_glasgow_images --ids "AUT-001, AUT-003" --apply    # download, write files, edit config

Idempotent per id: an id already present in the config is skipped. Politeness: 1 s between downloads, identifying UA.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests
from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "glasgow_image_candidates.json"
PUBLIC = ROOT / "site" / "public" / "assets" / "images"
GB_TS = ROOT / "site" / "src" / "config" / "gb" / "glasgow-images.ts"  # gb/ so the spelling gate treats it as British
UA = "ViewMediaBot (+https://glasgowloop.co.uk/contact) glasgow-image-activation"
TOWN = "glasgow"
W, H = 1200, 800
COMMONS_OFFSET = 1_000_000_000  # keeps Commons page ids from colliding with Pexels photo ids in sourcePhotoId

SEASON_OF = {"season:autumn": "autumn", "season:winter": "winter", "season:spring": "spring", "season:summer": "summer"}


def ids_from(arg: str) -> list[str]:
    return [x.strip().upper() for x in re.split(r"[,\s]+", arg) if x.strip()]


def destination(candidate: dict) -> tuple[str, str]:
    """-> ('season', 'autumn') or ('holiday', 'halloween'). The first season/holiday bucket wins."""
    for b in candidate["buckets"]:
        if b in SEASON_OF:
            return "season", SEASON_OF[b]
    for b in candidate["buckets"]:
        if b.startswith("holiday:"):
            return "holiday", b.split(":", 1)[1]
    raise ValueError(f"{candidate['id']} has no season or holiday bucket ({candidate['buckets']}); not handled here")


def alt_text(candidate: dict) -> str:
    desc = re.sub(r"\s+", " ", candidate.get("description") or "").strip().rstrip(".")
    if desc:
        desc = desc[:140].rsplit(" ", 1)[0] if len(desc) > 140 else desc
        return desc if "glasgow" in desc.lower() else f"{desc}, Glasgow"
    return "Glasgow"


def credit(candidate: dict) -> tuple[str, str]:
    via = "Pexels" if candidate.get("source") == "pexels" else "Wikimedia Commons"
    return f"Photo by {candidate.get('artist') or 'unknown author'}, {candidate['license']}, via {via}", candidate["page_url"]


def ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def season_line(entry_id: str, rel_path: str, candidate: dict, season: str) -> str:
    text, url = credit(candidate)
    source_id = candidate["pageid"] + (COMMONS_OFFSET if candidate.get("source") != "pexels" else 0)
    return (f"  {{ id: {ts_string(entry_id)}, path: {ts_string(rel_path)}, alt: {ts_string(alt_text(candidate))}, width: {W}, height: {H}, "
            f"attributionText: {ts_string(text)}, attributionUrl: {ts_string(url)}, seasons: ['{season}'], town_ids: ['{TOWN}'], sourcePhotoId: {source_id} }},")


def holiday_line(entry_id: str, rel_path: str, candidate: dict, holiday: str) -> str:
    text, url = credit(candidate)
    source_id = candidate["pageid"] + (COMMONS_OFFSET if candidate.get("source") != "pexels" else 0)
    return (f"  {{ id: {ts_string(entry_id)}, path: {ts_string(rel_path)}, alt: {ts_string(alt_text(candidate))}, width: {W}, height: {H}, "
            f"attributionText: {ts_string(text)}, attributionUrl: {ts_string(url)}, holiday: '{holiday}', town_ids: ['{TOWN}'], sourcePhotoId: {source_id} }},")


def next_number(ts_text: str, prefix: str) -> int:
    nums = [int(n) for n in re.findall(rf"id: '{re.escape(prefix)}-(\d+)'", ts_text)]
    return (max(nums) if nums else 0) + 1


def insert_before_array_end(ts_text: str, array_name: str, lines: list[str]) -> str:
    start = ts_text.index(f"export const {array_name}")
    end = ts_text.index("\n];", start)
    return ts_text[:end] + "\n" + "\n".join(lines) + ts_text[end:]


def crop_to_pool(raw: bytes) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    target = W / H
    if w / h > target:
        nw = round(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    img = img.resize((W, H), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    return out.getvalue()


def download(candidate: dict, session: requests.Session, pexels_key: str | None) -> bytes:
    if candidate.get("source") == "pexels":
        r = session.get(f"https://api.pexels.com/v1/photos/{candidate['pageid']}", headers={"Authorization": pexels_key or ""}, timeout=30)
        r.raise_for_status()
        url = r.json()["src"].get("large2x") or r.json()["src"]["large"]
        img = session.get(url, timeout=60)
    else:
        img = session.get(f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(candidate['title'])}?width=1600", timeout=60)
    img.raise_for_status()
    return img.content


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    load_dotenv(ROOT / ".env")
    pexels_key = os.environ.get("PEXELS_API_KEY")
    by_id = {c["id"]: c for c in json.loads(DATA.read_text(encoding="utf-8"))["candidates"]}
    wanted = ids_from(args.ids)
    missing = [i for i in wanted if i not in by_id]
    if missing:
        raise SystemExit(f"unknown ids: {missing}")

    gb_text = GB_TS.read_text(encoding="utf-8")
    tw_text = hol_text = gb_text
    session = requests.Session()
    session.headers["User-Agent"] = UA
    season_lines: list[str] = []
    holiday_lines: list[str] = []
    for cid in wanted:
        c = by_id[cid]
        kind, name = destination(c)
        folder = "this-week" if kind == "season" else "holidays"
        prefix = f"{TOWN}-{name}"
        existing = tw_text if kind == "season" else hol_text
        if f"sourcePhotoId: {c['pageid'] + (COMMONS_OFFSET if c.get('source') != 'pexels' else 0)}" in existing and f"id: '{prefix}-" in existing:
            print(f"{cid}: already active, skipped")
            continue
        n = next_number(existing, prefix) + sum(1 for l in (season_lines if kind == "season" else holiday_lines) if f"id: '{prefix}-" in l)
        entry_id = f"{prefix}-{n:02d}"
        rel = f"/assets/images/{folder}/{entry_id}.jpg"
        print(f"{cid} -> {kind} pool '{name}' as {entry_id}  ({credit(c)[0]})")
        if args.apply:
            time.sleep(1.0)
            data = crop_to_pool(download(c, session, pexels_key))
            dest = PUBLIC / folder / f"{entry_id}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        (season_lines if kind == "season" else holiday_lines).append(
            season_line(entry_id, rel, c, name) if kind == "season" else holiday_line(entry_id, rel, c, name))

    if not args.apply:
        print("dry run: nothing written")
        return
    out = gb_text
    if season_lines:
        out = insert_before_array_end(out, "GLASGOW_THIS_WEEK_IMAGES", season_lines)
    if holiday_lines:
        out = insert_before_array_end(out, "GLASGOW_HOLIDAY_IMAGES", holiday_lines)
    GB_TS.write_text(out, encoding="utf-8")
    print(f"activated {len(season_lines)} season and {len(holiday_lines)} holiday images")


if __name__ == "__main__":
    main()
