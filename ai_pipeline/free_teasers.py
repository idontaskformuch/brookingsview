"""Per-item teaser lines for the extended /events/free/ page (see Claude
Code handoff "Free Things To Do", v2 -- extend the existing page, don't
fork a new /free-things-to-do). A genuinely NEW pipeline shape, not a
digest: every other AI-generation module in this pipeline is tied to
recurring/dated content (CONTENT_TRACK_TYPES, weekly/monthly digests).
This is one-time-evergreen -- a facility's teaser is generated once and
never regenerated; an event's teaser is generated once while it's
upcoming. Both are cached in the DB (facilities.free_teaser,
stories.free_teaser -- db/migrations/036_free_teasers.sql) specifically
because the site rebuilds hourly and inline generation at Astro build
time would re-pay for the same sentence forever.

Two independent jobs:
  - Facilities: library/park/community_center rows with no teaser yet.
    Genuinely evergreen -- run once per town, re-run only picks up NEWLY
    seeded facilities. A deliberate, disclosed exception to this
    codebase's existing "no AI-generated narrative for a facility's own
    page" rule (see NEEDS-HUMAN-REVIEW.md) -- that rule is about a
    facility's PERMANENT reference-page description; this is a one-time
    paragraph on a DIFFERENT page, in a different context, not the same
    decision revisited. Per-facility output is a short PARAGRAPH (3-4
    sentences) -- not a one-line teaser -- covering what's actually
    there, its hours (from hours_text) and address, and a practical
    free-family-outing angle (parking, suitability for young children,
    shade, a playground) only when the source data actually supports it.
    Applied identically across all three towns for consistent quality;
    it's also what reliably pushes Broomfield's page (4 facilities) past
    any thin-content word-count floor, rather than landing right at the
    edge of one.
  - Events: source_type='event' stories that resolve as free per the
    SAME venue-category + paid-language rule site/src/lib/events.ts's
    isFreeEvent() already uses for filtering -- ported to Python here via
    the existing ai_pipeline/venue_registry.py rather than a second,
    independently-arrived-at classification. Meant to run on the regular
    scrape cadence (new free events appear continuously); facilities do
    not need that cadence.

Usage:
    python -m ai_pipeline.free_teasers --config configs/moreno_valley_ca.json --only facilities
    python -m ai_pipeline.free_teasers --config configs/moreno_valley_ca.json --only events
    python -m ai_pipeline.free_teasers --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg

from ai_pipeline import guardrails
from validation import pre_publish_check
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, pricing_for, resolve_model, safe_create,
    _record_spend, _spent_this_month,
)
from ai_pipeline.venue_registry import load_registry, resolve_venue

try:
    import anthropic
except ImportError:
    anthropic = None

# Mirrors site/src/lib/events.ts's FREE_VENUE_CATEGORIES / PAID_LANGUAGE_RE
# exactly -- same duplicate-across-layers tradeoff this codebase already
# makes for OUTLIER_PRICE_FLOOR / normalize_venue(). Keep both in sync.
FREE_VENUE_CATEGORIES = {"library", "park", "community_center"}
PAID_LANGUAGE_RE = re.compile(
    r"\$\d|admission fee|cover charge|tickets?\s+(required|on sale)|purchase\s+a\s+ticket",
    re.IGNORECASE,
)

MIN_EVENT_TEASER_WORDS = 4
# A 3-4 sentence paragraph, per Decision 5 -- floor is deliberately below a
# realistic 3-sentence paragraph so a slightly terse but valid one doesn't
# get bounced into the (thinner) template fallback for no real reason.
MIN_FACILITY_PARAGRAPH_WORDS = 24


def is_free_event(registry: dict, venue_raw: str | None, body: str) -> bool:
    facility = resolve_venue(registry, venue_raw)
    if not facility or facility["category"] not in FREE_VENUE_CATEGORIES:
        return False
    if PAID_LANGUAGE_RE.search(body or ""):
        return False
    return True


def _is_complete_sentence(text: str) -> bool:
    """Cheap guard against a response cut off mid-sentence by max_tokens --
    found live 2026-08-29 (Broomfield's Paul Derda Recreation Center, a
    longer facility with more real fields to cover, ran out of tokens and
    got stored ending mid-word: "...a solid option for a low-c"). The
    guardrail-content check alone doesn't catch this since a truncated
    sentence is still fully fact-grounded, just incomplete."""
    return text.rstrip().endswith(('.', '!', '?'))


def _guardrails_pass(text: str, source_text: str, cfg: dict, *,
                      source_records, content_type: str) -> guardrails.GuardrailResult:
    # No prediction/financial-advice/hedging concerns here (this isn't a
    # digest about a contested civic matter or a named business) -- the
    # base fact-in-source check is what matters: never a specific detail
    # (a program name, a schedule, a crowd claim) that isn't in the row's
    # own real fields.
    result = guardrails.validate(text, source_text, cfg)
    if result.passed:
        pre_publish = pre_publish_check(
            text, source_records=source_records, cfg=cfg, content_type=content_type,
        )
        if not pre_publish.passed:
            return guardrails.GuardrailResult(passed=False, violations=pre_publish.violations)
    return result


def facility_source_text(facility: dict) -> str:
    parts = [
        f"Name: {facility['name']}",
        f"Category: {facility['category']}",
    ]
    if facility.get("address"):
        parts.append(f"Address: {facility['address']}")
    if facility.get("hours_text"):
        parts.append(f"Hours: {facility['hours_text']}")
    if facility.get("description"):
        parts.append(f"Description: {facility['description']}")
    return "\n".join(parts)


def facility_template_fallback(facility: dict) -> str:
    """Safe, always-available fallback for a facility -- unlike an event
    (transient, self-resolving on the next run), a facility is permanent,
    so it should never sit with NULL forever just because the model failed
    validation twice in a row. Still a short paragraph per Decision 5, but
    built only from fields actually present -- no invented parking/shade/
    playground claims the way the AI path might add when the source data
    supports it."""
    sentences = []
    if facility["category"] == "community_center":
        sentences.append(f"{facility['name']} is free to enter, though some programs inside may charge a fee.")
    else:
        label = "park" if facility["category"] == "park" else "public library"
        sentences.append(f"{facility['name']} is a free-to-visit {label}.")
    if facility.get("address"):
        sentences.append(f"It's located at {facility['address']}.")
    if facility.get("hours_text"):
        sentences.append(f"Hours: {facility['hours_text']}.")
    sentences.append("A straightforward option for a free outing with the family.")
    return " ".join(sentences)


def generate_facility_teaser(facility: dict, cfg: dict, client=None) -> tuple[str, str]:
    """Returns (text, generated_by)."""
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return facility_template_fallback(facility), "template_fallback"

    if client is None:
        if anthropic is None:
            return facility_template_fallback(facility), "template_fallback"
        client = anthropic.Anthropic()

    model = resolve_model("free_teaser_facility", cfg)
    price_in, price_out = pricing_for(model)
    caveat_rule = (
        "This is a community/recreation center: it's free to ENTER, but some programs "
        "or classes inside may charge a fee. Your paragraph must reflect that -- never state "
        "or imply the center is free without qualification."
        if facility["category"] == "community_center" else
        "This venue (a park or library) is free to visit, full stop -- no caveat needed."
    )
    system = build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- FREE THINGS TO DO, FACILITY PARAGRAPH:
Write a short paragraph (3-4 sentences, plain prose, no line breaks or
bullets) covering, in roughly this order:
1. What this place actually is/offers -- grounded in its name, category,
   and description. Do not invent a specific program, amenity, or feature
   that isn't in the source data.
2. Its hours, if hours_text is given -- state them as given, never guess
   or round hours that aren't provided.
3. Its address, if given.
4. One practical, free-family-outing angle -- e.g. whether it suits young
   children, parking, shade, or a playground -- but ONLY if something in
   the source data (the description) actually supports it. If nothing in
   the source data supports a specific practical claim, write a plain,
   generic closing sentence instead -- never claim there's parking, shade,
   or a playground unless the source text says so.

{caveat_rule}

This paragraph appears on a "free things to do" landing page and must
read as a distinct angle on this facility (the free-family-outing angle)
-- not a copy or close paraphrase of its own existing description.

Return ONLY the paragraph. No preamble, no quotation marks, no bullet points."""

    src = facility_source_text(facility)

    def call(extra: str = "") -> str:
        msg = safe_create(client, model=model, max_tokens=350, system=system + extra,
                           messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}])
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()

    try:
        text = call()
        result = _guardrails_pass(text, src, cfg, source_records=facility, content_type="free_teaser_facility")
        complete = _is_complete_sentence(text)
        if not result.passed or not complete:
            extra = (
                "\n\nYour previous attempt included a detail not found in the source "
                "data, or made an unqualified free claim about a community center. "
                "Rewrite using ONLY the given facts."
                if not result.passed else
                "\n\nYour previous attempt was cut off mid-sentence. Write a SHORTER "
                "paragraph (2-3 sentences instead of 3-4) that finishes cleanly within "
                "the space you have."
            )
            text = call(extra)
            result = _guardrails_pass(text, src, cfg, source_records=facility, content_type="free_teaser_facility")
            complete = _is_complete_sentence(text)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return facility_template_fallback(facility), "template_fallback"

    if result.passed and complete and len(text.split()) >= MIN_FACILITY_PARAGRAPH_WORDS:
        return text, f"ai:{model}"

    print(f"  guardrail avvisade ({result.violations[:3]}) -- faller tillbaka på mall")
    return facility_template_fallback(facility), "template_fallback"


def generate_event_teaser(title: str, body: str, cfg: dict, client=None) -> tuple[str, str] | None:
    """Returns (text, generated_by), or None if generation failed and no
    safe template fallback applies -- unlike a facility, a transient event
    with no teaser this run just shows without one; the next run (new
    source data or none) tries again while it's still upcoming."""
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return None

    if client is None:
        if anthropic is None:
            return None
        client = anthropic.Anthropic()

    model = resolve_model("free_teaser_event", cfg)
    price_in, price_out = pricing_for(model)
    system = build_system_prompt(cfg) + """

FORMAT OVERRIDE -- FREE THINGS TO DO, EVENT TEASER:
Write ONE short, practical sentence (max 20 words) on what this free
event actually involves or why it's worth going -- not a restated title,
not an invented specific (no made-up crowd size, no "hidden gem" claim
with nothing behind it). Ground it only in what the source text actually
says.

Return ONLY the sentence. No preamble, no quotation marks."""

    src = f"Title: {title}\nDescription: {body}"

    def call(extra: str = "") -> str:
        msg = safe_create(client, model=model, max_tokens=100, system=system + extra,
                           messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}])
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()

    try:
        text = call()
        result = _guardrails_pass(text, src, cfg, source_records={"title": title, "body": body},
                                   content_type="free_teaser_event")
        complete = _is_complete_sentence(text)
        if not result.passed or not complete:
            text = call("\n\nYour previous attempt included a detail not found in the "
                        "source data, or was cut off mid-sentence. Rewrite using ONLY "
                        "the given facts, shorter if needed to finish cleanly.")
            result = _guardrails_pass(text, src, cfg, source_records={"title": title, "body": body},
                                       content_type="free_teaser_event")
            complete = _is_complete_sentence(text)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc})")
        return None

    if result.passed and complete and len(text.split()) >= MIN_EVENT_TEASER_WORDS:
        return text, f"ai:{model}"

    print(f"  guardrail avvisade ({result.violations[:3]})")
    return None


def run_facilities(conn, cfg: dict, dry_run: bool) -> int:
    town_id = cfg["town_id"]
    placeholders = ",".join(["%s"] * len(FREE_VENUE_CATEGORIES))
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, category, address, hours_text, description
              FROM facilities
             WHERE town_id = %s AND category IN ({placeholders}) AND free_teaser IS NULL
            """,
            (town_id, *FREE_VENUE_CATEGORIES),
        )
        rows = cur.fetchall()

    print(f"  {len(rows)} facility(ies) need a teaser")
    updated = 0
    for fid, name, category, address, hours_text, description in rows:
        facility = {"id": fid, "name": name, "category": category, "address": address,
                     "hours_text": hours_text, "description": description}
        text, generated_by = generate_facility_teaser(facility, cfg)
        print(f"  [{category}] {name}: {text!r} ({generated_by})")
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute("UPDATE facilities SET free_teaser = %s WHERE id = %s", (text, fid))
            updated += 1
    if not dry_run:
        conn.commit()
    return updated


def run_events(conn, cfg: dict, dry_run: bool) -> int:
    town_id = cfg["town_id"]
    registry = load_registry(conn, town_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, body, venue_raw
              FROM stories
             WHERE town_id = %s AND source_type = 'event'
               AND occurs_at >= now() AND free_teaser IS NULL
            """,
            (town_id,),
        )
        rows = cur.fetchall()

    candidates = [(sid, title, body, venue_raw) for sid, title, body, venue_raw in rows
                  if is_free_event(registry, venue_raw, body)]
    print(f"  {len(rows)} upcoming event(s) without a teaser, {len(candidates)} classify as free")

    updated = 0
    for sid, title, body, venue_raw in candidates:
        result = generate_event_teaser(title, body, cfg)
        if result is None:
            print(f"  {title!r}: no teaser this run (will retry next run)")
            continue
        text, generated_by = result
        print(f"  {title!r}: {text!r} ({generated_by})")
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute("UPDATE stories SET free_teaser = %s WHERE id = %s", (text, sid))
            updated += 1
    if not dry_run:
        conn.commit()
    return updated


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", choices=["facilities", "events"], help="restrict to one job")
    ap.add_argument("--dry-run", action="store_true",
                    help="generate and print, but write nothing (real AI calls -- costs the same as a real run)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        if args.only in (None, "facilities"):
            print("Facilities:")
            n = run_facilities(conn, cfg, args.dry_run)
            print(f"  -> {n} updated" if not args.dry_run else "  (dry-run -- nothing written)")
        if args.only in (None, "events"):
            print("Events:")
            n = run_events(conn, cfg, args.dry_run)
            print(f"  -> {n} updated" if not args.dry_run else "  (dry-run -- nothing written)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
