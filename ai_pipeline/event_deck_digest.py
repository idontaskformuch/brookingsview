"""Marquee deck sentences (presentation-layer follow-up, Part A).

A one-sentence "deck" description under a marquee-tier Ticketmaster event's
hero card on the front page and /whats-on, grounded ONLY in fields already on
that event's own Discovery API record -- act/title, venue, date,
classification/genre, price range. Never invented significance, never
invented availability. See MarqueeCard.astro's own doc comment for why this
generator didn't exist before now: the only prior AI path
(ai_pipeline/whats_on_intro.py) writes one shared WEEKLY paragraph about the
week's events in aggregate, not a sentence grounded in one specific event.

ARCHITECTURE: reuses whats_on_intro.py's own fetch/normalize/venue-tier/
run-collapsing functions directly (same-language reuse within ai_pipeline,
not the cross-layer Python<->TS duplication this codebase accepts
elsewhere) -- it's the only other Python module that talks to Ticketmaster
at all, and this script's whole fetch pipeline up through collapse_runs() is
identical to it. Does NOT reuse week_bounds()/filter_to_week(): this script
isn't week-scoped, it processes whatever's currently ranked into marquee
tier, regardless of week.

Keyed per (town_id, ticketmaster_event_id), NOT per week -- content_hash is
over THIS EVENT's own grounding fields (title, venue, date, price,
classification), so a row regenerates only when that specific event's record
actually changes, or it's newly promoted into marquee tier. Cost is bounded
by definition: only the top `marquee_size` (configs/<town>.json's
features.whats_on.ticketmaster.marquee_size -- the SAME value
site/src/lib/site-config.ts's SiteConfig.ticketmaster.marqueeSize carries,
kept in sync by hand) events per town ever get a sentence, not the full feed.

Gated on the SAME features.whats_on.enabled + features.whats_on.ticketmaster.
enabled flags whats_on_intro.py already checks -- no new config schema.

Running:
    python -m ai_pipeline.event_deck_digest --config configs/brookings_sd.json
    python -m ai_pipeline.event_deck_digest --config configs/brookings_sd.json --dry-run
    python -m ai_pipeline.event_deck_digest --config configs/brookings_sd.json --force
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg

from ai_pipeline import guardrails
from validation import pre_publish_check
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)
from ai_pipeline.whats_on_intro import (
    _TIER_LABEL, collapse_runs, fetch_events, venue_tier_for,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "event_deck"

# One sentence, not a paragraph -- enforced in code, not just asked for.
MAX_CHARS = 160

# Mirrors site/src/lib/venue-tiers.ts's own VENUE_TIER_ORDER exactly
# (['small', 'medium', 'large'], via venueTierRank() = indexOf) -- small is
# deliberately lowest, see that file's own DEFAULT_VENUE_TIER comment.
_TIER_RANK = {"small": 0, "medium": 1, "large": 2}


def venue_tier_rank(tier: str) -> int:
    return _TIER_RANK.get(tier, 0)


def rank_events(entries: list[dict], town_id: str) -> list[dict]:
    """Mirrors site/src/lib/whats-on.ts's rankTicketmasterEvents() exactly:
    highest venue tier first, then soonest occurs_at, then title
    (alphabetical) as the final tiebreak -- same three-key sort, same
    order. `entries` are already-collapsed (see collapse_runs()), so each
    is ranked by its own `primary`-equivalent (this dict itself, since
    collapse_runs() merges members INTO the entry rather than keeping a
    separate `primary` key the way whats-on.ts's MarqueeEntry does)."""
    def sort_key(entry: dict):
        tier = venue_tier_for(town_id, entry.get("venue_name"), entry.get("venue_id"))
        occurs_at = entry.get("occurs_at") or "9999"
        return (-venue_tier_rank(tier), occurs_at, entry.get("title") or "")

    return sorted(entries, key=sort_key)


def select_marquee(raw_events: list[dict], town_id: str, marquee_size: int) -> list[dict]:
    """collapse_runs() -> rank_events() -> top `marquee_size` -- this is
    what bounds cost. Only events landing here ever get a deck sentence."""
    collapsed = collapse_runs(raw_events)
    return rank_events(collapsed, town_id)[:marquee_size]


def digest_key(entry: dict) -> str:
    """Stable key for a collapsed entry, mirroring site/src/lib/whats-on.ts's
    own marqueeDigestKey() exactly -- see that function's own doc comment for
    why this is NOT simply entry["id"] (the primary/first-collapsed member's
    own event id) for a real multi-date run: WHICH member becomes "first"
    depends on the order Discovery API happens to return results in, which
    is not guaranteed stable across two separate live fetches (this script's
    own fetch here vs. the Astro build's own independent one reading this
    table back) -- confirmed live: a real deck sentence went missing on a
    real build because of exactly this. Uses the SAME attraction_id::
    venue_id pair collapse_runs() already uses to decide grouping --
    intrinsic to the show, not fetch-order-dependent. A standalone event (no
    attraction_id, collapse_runs() never merges it) keeps its own plain
    event id, which IS stable (only one id exists for it)."""
    if entry.get("attraction_id"):
        return f"{entry['attraction_id']}::{entry.get('venue_id') or entry.get('venue_name') or ''}"
    return entry["id"]


# --- grounding text + prompt ---------------------------------------------------

_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _format_local(local_date: str | None, local_time: str | None) -> str:
    """Mirrors whats_on_intro.py's own _format_local() date/time formatting
    (duplicated rather than imported since that one also returns the real
    weekday name for check_weekday_consistency(), which this generator has
    no equivalent of -- see this module's own docstring)."""
    if not local_date:
        return "date TBA"
    from datetime import datetime
    y, m, d = (int(x) for x in local_date.split("-"))
    dt = datetime(y, m, d)
    weekday = _WEEKDAY_NAMES[dt.weekday()]
    label = f"{weekday}, {dt.strftime('%B')} {d}"
    if local_time:
        h, mnt, _ = (int(x) for x in local_time.split(":"))
        h12 = h % 12 or 12
        period = "AM" if h < 12 else "PM"
        label += f", {h12}:{mnt:02d} {period}"
    return label


def build_grounding_text(entry: dict, town_id: str) -> str:
    """Per-EVENT grounding (not per-week, unlike whats_on_intro.py's
    build_grounding_text()) -- every fact the deck sentence is allowed to
    draw on, and nothing else."""
    tier = venue_tier_for(town_id, entry.get("venue_name"), entry.get("venue_id"))
    dist = entry.get("venue_distance_miles")
    dist_text = f"~{round(dist)} miles from town" if dist is not None else "distance unknown"
    members = entry.get("members") or [entry]
    dates = "; ".join(_format_local(m.get("local_date"), m.get("local_time")) for m in members)
    run_note = f" ({len(members)} performances this run)" if len(members) > 1 else ""

    lines = [
        f"EVENT: {entry['title']}",
        f"Classification: {entry.get('segment') or 'unclassified'}"
        + (f" / {entry['genre']}" if entry.get("genre") else ""),
        f"Venue: {entry.get('venue_name') or 'venue TBA'} ({_TIER_LABEL.get(tier, 'venue')}), {dist_text}",
        f"Date(s): {dates}{run_note}",
    ]
    if entry.get("price_range_text"):
        lines.append(f"Price range: {entry['price_range_text']}")
    return "\n".join(lines)


def build_prompt(cfg: dict) -> str:
    return build_system_prompt(cfg) + """

FORMAT OVERRIDE -- MARQUEE DECK SENTENCE:
You are writing ONE sentence to appear under a single event's hero card on a
"What's On" events page, right below the event's own title (which the reader
already sees).

ABSOLUTE HARD RULES (violating any of these makes the output unusable):
- Use ONLY the fields in SOURCE DATA below: title, classification/genre,
  venue name, venue capacity ("a large-capacity venue" / "a mid-size venue" /
  "a small venue"), distance, date(s)/time(s), and price range if given. You
  do NOT know whether this act is good, popular, or locally beloved, and you
  know NOTHING about this venue beyond its name and capacity. NEVER write
  anything implying otherwise -- no "don't miss", no "fan-favorite", no
  "acclaimed", no invented enthusiasm.
- You may recognize a real touring performer's name, or a real venue's name,
  from your own training. You MUST NOT use that outside knowledge for
  ANYTHING not explicitly given in SOURCE DATA -- most importantly, NEVER
  name a city, town, state, or any other place beyond the venue name and
  distance figure given (SOURCE DATA never includes the venue's real city,
  precisely so a recognized venue's real location never leaks in this way).
  The same rule applies to genre: use ONLY the Classification given -- if it
  reads "Miscellaneous" or is otherwise vague, describe the event
  generically ("a show", "a performance") rather than guessing a more
  specific category from the performer's or venue's name alone.
- Never state or imply ticket availability (on sale, sold out, limited) --
  SOURCE DATA never includes real-time sales status, so any such claim would
  be invented.
- Exactly one sentence. No preamble, no title, no markdown, no trailing
  disclaimer.
- If SOURCE DATA is too sparse to write one honest, grounded sentence beyond
  simply repeating the title, respond with exactly: NONE

Return ONLY the sentence (or the literal word NONE)."""


def content_hash(entry: dict) -> str:
    """Over this event's own grounding fields -- a real change (price
    posted, date shifted) invalidates the cache; the event merely still
    existing does not."""
    members = entry.get("members") or [entry]
    parts = [
        entry.get("title") or "", entry.get("venue_name") or "", entry.get("venue_id") or "",
        entry.get("segment") or "", entry.get("genre") or "", entry.get("price_range_text") or "",
        "|".join(sorted(m.get("id") or "" for m in members)),
        "|".join(sorted(f"{m.get('local_date')}T{m.get('local_time')}" for m in members)),
    ]
    return hashlib.sha256("::".join(parts).encode()).hexdigest()


def check_deck(candidate: str, src: str, cfg: dict) -> tuple[bool, list[str]]:
    """The full validation gate for one candidate sentence -- standalone and
    network-free so it's directly unit-testable, mirrors
    whats_on_intro.check_intro()'s composition (length ceiling ->
    guardrails.validate() -> pre_publish_check()) minus the week-specific
    weekday check that generator alone needs."""
    violations: list[str] = []
    if len(candidate) > MAX_CHARS:
        violations.append(f"over length: {len(candidate)} chars > {MAX_CHARS} ceiling")
    violations += guardrails.validate(candidate, src, cfg).violations
    if not violations:
        violations = pre_publish_check(
            candidate, source_records=[entry_from_src(src)], cfg=cfg, content_type=SOURCE_TYPE,
        ).violations
    return not violations, violations


def entry_from_src(src: str) -> dict:
    """pre_publish_check() wants source_records as dict(s) with real field
    names (see validation/_text.py's flatten_records) -- the grounding TEXT
    itself is what guardrails.validate() checks candidate text against, but
    pre_publish_check's own place/date-coherence checks want structured
    values. A minimal dict is enough here since this generator's own
    grounding never claims a town/state beyond what build_system_prompt()
    already establishes -- see check_deck()'s caller for how `src` and this
    are kept trivially in sync (built from the SAME entry, never separately)."""
    return {"body": src}


def generate(entry: dict, cfg: dict, town_id: str, client=None) -> tuple[str, str] | None:
    """Returns (text, generated_by) on a check-passing, non-"NONE" draft, or
    None if nothing should be written (budget cap, no client, API failure,
    the model itself saying NONE, or a guardrail/pre_publish_check
    rejection surviving one retry)."""
    src = build_grounding_text(entry, town_id)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return None

    if client is None:
        if anthropic is None:
            return None
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg)

    def call(extra: str = "") -> str | None:
        try:
            msg = safe_create(
                client, model=model, max_tokens=120, system=system + extra,
                messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
            )
        except GenerationUnavailable as exc:
            print(f"  [event_deck_digest] AI call failed ({exc}) -- no deck this run", file=sys.stderr)
            return None
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        return check_deck(candidate, src, cfg)

    text = call()
    if text is None:
        return None
    text = text.strip()
    if text == "NONE":
        return None

    passed, violations = _checks_pass(text)
    if not passed:
        text = call(
            "\n\nYour previous attempt either exceeded one sentence, named a CITY/TOWN/STATE not "
            "given in SOURCE DATA (a common mistake: you may recognize the real venue and be "
            "tempted to name its real-world location -- don't, SOURCE DATA deliberately omits it), "
            "named some other thing not in SOURCE DATA, implied availability/quality/popularity "
            "you don't know, or wasn't actually grounded enough -- if it truly can't be grounded, "
            "respond NONE instead. Otherwise rewrite it: one sentence, using ONLY facts from "
            "SOURCE DATA, no place name beyond the venue name and distance figure given."
        )
        if text is None:
            return None
        text = text.strip()
        if text == "NONE":
            return None
        passed, violations = _checks_pass(text)

    if passed:
        return text, f"ai:{model}"

    print("  [event_deck_digest] guardrail rejection survived retry -- writing nothing")
    for v in violations[:5]:
        print(f"    - {v}")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true", help="regenerate even if an event's content hash is unchanged")
    ap.add_argument("--dry-run", action="store_true", help="fetch + generate and print, but write NOTHING to the DB")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    feat = cfg.get("features", {}).get("whats_on", {})
    tm = feat.get("ticketmaster", {})

    if not feat.get("enabled") or not tm.get("enabled"):
        print(f"What's On (or its Ticketmaster source) disabled for {town_id} -- nothing to do")
        return 0

    coords = cfg.get("coordinates", {})
    api_key = os.environ.get("TICKETMASTER_API_KEY")
    marquee_size = tm.get("marquee_size", 6)

    raw_events = fetch_events(coords.get("lat"), coords.get("lon"), tm.get("radius_miles", 75), api_key)
    # Collapsed once here (not just inside select_marquee()) so pruning below
    # can check against every LIVE entry's digest_key(), not just the top
    # `marquee_size` -- a run merely demoted out of marquee tier this run
    # must not be pruned, only one that's genuinely gone from the feed.
    all_collapsed = collapse_runs(raw_events)
    marquee = rank_events(all_collapsed, town_id)[:marquee_size]
    live_keys = {digest_key(e) for e in all_collapsed}
    print(f"  {len(raw_events)} live event(s), {len(marquee)} in marquee tier (size {marquee_size})")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        # Prune rows for events no longer present anywhere in the live feed
        # at all (expired) -- NOT rows merely outside the current top
        # `marquee_size`, so a temporarily-demoted event doesn't need
        # regenerating if it re-enters marquee tier later.
        if live_keys and not args.dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM event_deck_digest WHERE town_id=%s AND NOT (ticketmaster_event_id = ANY(%s))",
                    (town_id, list(live_keys)),
                )
            conn.commit()

        written = 0
        for entry in marquee:
            key = digest_key(entry)
            new_hash = content_hash(entry)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT content_hash FROM event_deck_digest WHERE town_id=%s AND ticketmaster_event_id=%s",
                    (town_id, key),
                )
                row = cur.fetchone()
            existing_hash = row[0] if row else None

            if existing_hash == new_hash and not args.force:
                continue

            if args.dry_run:
                result = generate(entry, cfg, town_id)
                print(f"\n--- {entry['title']} ---")
                print(result[0] if result else "  (no deck generated)")
                continue

            result = generate(entry, cfg, town_id)
            if result is None:
                # A prior row for this exact event, now failing to
                # regenerate (record changed enough to invalidate the hash
                # but not enough to ground a fresh sentence), must not
                # linger describing a stale version of the event.
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM event_deck_digest WHERE town_id=%s AND ticketmaster_event_id=%s",
                        (town_id, key),
                    )
                conn.commit()
                continue

            text, generated_by = result
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO event_deck_digest (town_id, ticketmaster_event_id, body, content_hash, generated_by)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (town_id, ticketmaster_event_id) DO UPDATE SET
                        body = EXCLUDED.body, content_hash = EXCLUDED.content_hash,
                        generated_by = EXCLUDED.generated_by, created_at = now()
                    """,
                    (town_id, key, text, new_hash, generated_by),
                )
            conn.commit()
            written += 1

        print(f"  {written} deck sentence(s) written/updated")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
