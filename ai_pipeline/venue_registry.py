"""Venue resolution for Event JSON-LD (see NEEDS-HUMAN-REVIEW.md, "Event
JSON-LD venue resolution & emission rules").

CORE PRINCIPLE: address correctness is an eligibility and trust issue for
Google's Event rich result. We never synthesize or guess a per-event
address from a scraped venue string -- we resolve it against `facilities`
(db/migrations/007_facilities.sql + 020_event_venue_resolution.sql), a
small, hand-verified registry, and only claim rich-result eligibility when
the venue actually resolves.

TWO SEPARATE JOBS, deliberately split:
  1. WRITE side (this module, called from ai_pipeline/publish.py once per
     newly-published event): resolve the venue for logging purposes and,
     if unresolved, record it in `venue_review_queue` -- a natural,
     once-per-new-event write, not something that should run from a
     read-only site build (which can re-run many times with no new source
     data and would otherwise inflate occurrence counts every rebuild).
  2. READ side (site/src/lib/db.ts, a parallel TypeScript implementation of
     normalize_venue()): resolves against `facilities` fresh at every site
     build, so adding an alias to the registry re-resolves every previously
     unmatched event on the next rebuild with no pipeline re-run needed.
     Kept as a small duplicated algorithm rather than a cross-language
     shared module -- same tradeoff this codebase already makes for
     OUTLIER_PRICE_FLOOR (see ai_pipeline/home_sales_digest.py and
     site/src/pages/home-sales.astro).
"""
from __future__ import annotations

import re

# Source LOCATION strings seen so far never actually have a "LABEL:" prefix
# (verified against real scraped data -- Tockify/Google-Calendar-style
# exports give "Name,Street, City, ST ZIP, USA"), but a raw string with one
# is a plausible shape from a different feed/town, so strip it defensively.
_LABEL_PREFIX_RE = re.compile(r"^[A-Z0-9 .'\-]+:\s*")
_WHITESPACE_RE = re.compile(r"\s+")

_VIRTUAL_KEYWORDS = (
    "virtual", "online event", "zoom", "webinar", "livestream", "webex",
    "google meet", "microsoft teams", "teams meeting", "via video",
)


def normalize_venue(raw: str | None) -> str | None:
    """The matchable identity of a raw venue string: lowercase, collapsed
    whitespace, any address tail after the first comma dropped (scraped
    LOCATION strings are "Name,Street, City, ST ZIP, USA" -- only the name
    part is what a human-curated alias would ever list)."""
    if not raw or not raw.strip():
        return None
    name_part = raw.split(",", 1)[0]
    name_part = _LABEL_PREFIX_RE.sub("", name_part)
    normalized = _WHITESPACE_RE.sub(" ", name_part).strip().lower()
    return normalized or None


def is_virtual(*texts: str | None) -> bool:
    """True if any of the given texts (venue, description, ...) reads as a
    virtual-only event. Deliberately keyword-based and conservative -- a
    false negative here just means the event goes through normal venue
    resolution (worst case: queued for review), never a wrong physical
    address."""
    joined = " ".join(t for t in texts if t).lower()
    return any(kw in joined for kw in _VIRTUAL_KEYWORDS)


def load_registry(conn, town_id: str) -> dict[str, dict]:
    """normalized-alias -> facility dict, built from every facility's `name`
    plus its `aliases[]`. A facility with no `street_address`/`postal_code`
    resolves (for display purposes) but the caller must still treat it as
    ineligible for rich-result Event markup -- see resolve_venue()."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT slug, name, aliases, category, address, street_address,
                   postal_code, phone, website, lat, lon
              FROM facilities WHERE town_id = %s
            """,
            (town_id,),
        )
        rows = cur.fetchall()

    registry: dict[str, dict] = {}
    for slug, name, aliases, category, address, street_address, postal_code, phone, website, lat, lon in rows:
        facility = {
            "slug": slug, "name": name, "category": category, "address": address,
            "street_address": street_address, "postal_code": postal_code,
            "phone": phone, "website": website, "lat": lat, "lon": lon,
        }
        for candidate in (name, *(aliases or [])):
            norm = normalize_venue(candidate)
            if norm:
                registry[norm] = facility
    return registry


def resolve_venue(registry: dict[str, dict], raw_venue: str | None) -> dict | None:
    """The matched facility dict, or None if `raw_venue` doesn't match any
    known name/alias. Does NOT check street_address/postal_code completeness
    -- callers building JSON-LD must additionally check those before
    emitting a rich-result Place (see site/src/lib/db.ts:hasResolvedAddress
    for the read-side equivalent)."""
    norm = normalize_venue(raw_venue)
    if norm is None:
        return None
    return registry.get(norm)


def has_resolved_address(facility: dict | None) -> bool:
    return bool(facility and facility.get("street_address") and facility.get("postal_code"))


def queue_for_review(conn, town_id: str, raw_venue: str) -> None:
    """Record an unresolved venue string for a human to triage, deduped by
    normalized form with a running occurrence count and up to 3 distinct raw
    examples. Called once per newly-published event with an unresolved
    venue -- see ai_pipeline/publish.py."""
    norm = normalize_venue(raw_venue)
    if norm is None:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO venue_review_queue
                (town_id, normalized_venue, raw_examples, occurrence_count)
            VALUES (%s, %s, ARRAY[%s]::text[], 1)
            ON CONFLICT (town_id, normalized_venue) DO UPDATE SET
                occurrence_count = venue_review_queue.occurrence_count + 1,
                last_seen_at = now(),
                raw_examples = CASE
                    WHEN %s = ANY(venue_review_queue.raw_examples)
                        THEN venue_review_queue.raw_examples
                    WHEN cardinality(venue_review_queue.raw_examples) >= 3
                        THEN venue_review_queue.raw_examples
                    ELSE array_append(venue_review_queue.raw_examples, %s)
                END
            """,
            (town_id, norm, raw_venue, raw_venue, raw_venue),
        )
