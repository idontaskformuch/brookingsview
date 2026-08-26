"""Venue & Category Image Identity acceptance test (see NEEDS-HUMAN-REVIEW.md
and site/src/lib/images.ts's module docstring) -- prints every event story
from the last 90 days with the facility its image would resolve to, or
UNMATCHED. Run before shipping; paste the unmatched list into the PR notes.

Deliberately a duplicate, Python-side implementation of images.ts's
normalizeVenueText()/extractTitleVenuePrefix()/resolveVenueSlugForImage()
-- same "small algorithm duplicated across an incompatible runtime
boundary" tradeoff this codebase already makes for
ai_pipeline/venue_registry.py's normalize_venue() vs. lib/db.ts's
TypeScript twin. Keep the two in sync by hand if the matching rules ever
change.

IMPORTANT: this mirrors images.ts's own priority order, title-prefix
BEFORE venue_raw -- a deliberate deviation from the original brief's
"trust the FK/venue_raw first" instruction, made because Moreno Valley's
library-branch events showed a real, measured 18% venue_raw mismatch rate
against their own title prefix (125 of 688 checked live, only 6 of which
were recurring-series rows) -- see images.ts's docstring for the full
evidence. A wrong venue image is a worse reader-facing error than no
image, so the more reliable signal wins for image resolution specifically.
This does NOT change Event JSON-LD venue resolution (ai_pipeline/
venue_registry.py, lib/db.ts's resolveVenue()), which is unaffected.

Usage:
    python -m scripts.audit_venue_matches --town moreno_valley_ca
    python -m scripts.audit_venue_matches --town brookings_sd
"""
from __future__ import annotations

import argparse
import json
import re

from db.db import get_conn

NOISE_WORDS = {"library", "branch", "location", "the"}
EXPANSIONS = {"mv": "moreno valley", "sdsu": "south dakota state university"}
_PUNCT_RE = re.compile(r"[^\w\s]")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_venue_text(raw: str) -> str:
    words: list[str] = []
    for word in _WHITESPACE_RE.split(_PUNCT_RE.sub(" ", raw.lower())):
        if not word:
            continue
        words.extend(EXPANSIONS.get(word, word).split(" "))
    while len(words) > 1 and words[-1] in NOISE_WORDS:
        words.pop()
    return " ".join(words)


def extract_title_venue_prefix(title: str, city_name: str) -> str | None:
    without_town = title[len(city_name) + 2:] if title.startswith(f"{city_name}: ") else title
    if ":" not in without_town:
        return None
    prefix = without_town.split(":", 1)[0].strip()
    return prefix or None


def build_name_alias_index(facilities: list[dict]) -> dict[str, str]:
    entries: list[tuple[str, str]] = []
    for facility in facilities:
        for alias in facility["name_aliases"] or []:
            normalized = normalize_venue_text(alias)
            if normalized:
                entries.append((normalized, facility["slug"]))
    entries.sort(key=lambda e: len(e[0]), reverse=True)
    index: dict[str, str] = {}
    for normalized, slug in entries:
        index.setdefault(normalized, slug)
    return index


def resolve_venue_slug(title: str, venue_raw: str | None, index: dict[str, str], city_name: str) -> str | None:
    title_prefix = extract_title_venue_prefix(title, city_name)
    if title_prefix:
        slug = index.get(normalize_venue_text(title_prefix))
        if slug:
            return slug
    if venue_raw:
        name_part = venue_raw.split(",", 1)[0]
        slug = index.get(normalize_venue_text(name_part))
        if slug:
            return slug
    return None


def load_city_name(town_id: str) -> str:
    with open(f"configs/{town_id}.json", encoding="utf-8") as f:
        return json.load(f)["display_name"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", required=True, choices=["brookings_sd", "moreno_valley_ca"])
    ap.add_argument("--days", type=int, default=90)
    args = ap.parse_args()

    city_name = load_city_name(args.town)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT slug, name, name_aliases FROM facilities WHERE town_id = %s
                """,
                (args.town,),
            )
            facilities = [
                {"slug": slug, "name": name, "name_aliases": name_aliases}
                for slug, name, name_aliases in cur.fetchall()
            ]
            index = build_name_alias_index(facilities)

            cur.execute(
                """
                SELECT slug, title, venue_raw
                  FROM stories
                 WHERE town_id = %s
                   AND source_type = 'event'
                   AND coalesce(occurs_at, published_at) >= now() - (%s || ' days')::interval
                 ORDER BY coalesce(occurs_at, published_at) DESC
                """,
                (args.town, args.days),
            )
            rows = cur.fetchall()

    matched = 0
    unmatched: list[tuple[str, str]] = []
    for slug, title, venue_raw in rows:
        resolved = resolve_venue_slug(title, venue_raw, index, city_name)
        if resolved:
            matched += 1
            print(f"  MATCH      {slug:40s} -> {resolved}")
        else:
            unmatched.append((slug, title))
            print(f"  UNMATCHED  {slug:40s}    {title}")

    print(f"\n{args.town}: {matched} matched, {len(unmatched)} unmatched, {len(rows)} total "
          f"(last {args.days} days).")
    if unmatched:
        print("\nUnmatched events (paste into PR notes):")
        for slug, title in unmatched:
            print(f"  {slug}: {title}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
