""""What happened" meeting follow-ups -- see NEEDS-HUMAN-REVIEW.md, "3.2 City
hall". The existing meeting story (ai_pipeline/publish.py) previews the
AGENDA: what the body *will* discuss, built before the meeting happens. This
script covers the gap the brief calls out as the real editorial value: a
short follow-up on what the body actually *decided*, built from the posted
minutes (eSCRIBE's "PostMinutes" PDF, see scrapers/parsers/escribe_v1.py),
which only becomes available days after the meeting.

Deliberately a separate script, not folded into publish.py's per-row loop:
publish.py's contract is "read one row from a source table, publish once,
never revisit" (ON CONFLICT DO NOTHING) -- a follow-up is a SECOND story for
a meeting that's already been published once, gated on data (minutes posted)
that shows up on its own schedule, not on the row's insert. Idempotent via a
deterministic slug (meeting-followup-<meeting id>) and a re-run naturally
picks up any meeting whose minutes have since appeared and doesn't have one
yet -- no separate "already tried" bookkeeping needed.

Cadence: run this in the same scheduled job as publish.py, after it (see
.github/workflows). A meeting's minutes typically post days after the
meeting itself, so most runs will find nothing new for very recent meetings
-- expected, not a bug.

Usage:
    python -m ai_pipeline.meeting_followups --config configs/moreno_valley_ca.json
    python -m ai_pipeline.meeting_followups --config configs/moreno_valley_ca.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from calendar import month_name
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)
from ai_pipeline.publish import prefix_town_name

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "meeting_followup"
MIN_MINUTES_CHARS = 200   # a near-empty PDF extraction isn't worth summarizing
MIN_WORDS = 30            # a real "what happened" note, not a one-liner


def find_candidates(conn, town_id: str) -> list[dict]:
    """Past meetings with posted minutes text and no follow-up story yet."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT m.id, m.body, m.meeting_date, m.agenda_url, m.minutes_url, m.raw_data
              FROM meetings m
             WHERE m.town_id = %s
               AND m.meeting_date < now()
               AND m.raw_data ? 'minutes_text'
               AND length(m.raw_data->>'minutes_text') >= %s
               AND NOT EXISTS (
                     SELECT 1 FROM stories s
                      WHERE s.town_id = m.town_id AND s.slug = 'meeting-followup-' || m.id
                   )
             ORDER BY m.meeting_date DESC
            """,
            (town_id, MIN_MINUTES_CHARS),
        )
        return [dict(r) for r in cur.fetchall()]


def build_prompt(cfg: dict, body: str, label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- MEETING FOLLOW-UP:
The SOURCE DATA below is the OFFICIAL POSTED MINUTES of a {body} meeting held
{label} -- not the agenda preview (a separate, already-published story covers
what was on the agenda). Write a short "what happened" note: what the body
actually decided or voted on, in 2-4 sentences. Use ONLY outcomes explicitly
stated in the minutes -- vote counts, approvals, denials, continuances --
never speculate about why, and never restate the agenda item's description
if the minutes don't confirm what happened to it.

If the minutes are procedural only (roll call, approval of a prior meeting's
minutes, adjournment) with no substantive decision recorded, say plainly that
no major decisions were recorded at this meeting -- do not pad the wordcount
with procedural detail to look substantive.

Return ONLY the note text. No preamble, no title."""


def template_fallback(body: str, label: str) -> str:
    return (
        f"Minutes have been posted for the {body} meeting on {label}. "
        "See the official minutes for the full record of what was decided."
    )


def generate(cfg: dict, body: str, label: str, minutes_text: str, client=None) -> tuple[str, str, bool]:
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return template_fallback(body, label), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(body, label), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, body, label)
    src = f"MINUTES ({body}, {label}):\n{minutes_text}"

    def call(extra: str = "") -> str:
        msg = safe_create(
            client, model=model, max_tokens=400, system=system + extra,
            messages=[{"role": "user", "content": src}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    try:
        text = call()
        result = guardrails.validate(text, src, cfg)
        if not result.passed:
            text = call("\n\nYour previous attempt included details not in the minutes. "
                        "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
            result = guardrails.validate(text, src, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(body, label), "template_fallback", True

    if result.passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not result.passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    return template_fallback(body, label), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        candidates = find_candidates(conn, town_id)
        if not candidates:
            print("  inga möten med opublicerade minutes just nu")
            return 0

        published = 0
        for m in candidates:
            body = m["body"] or "Meeting"
            # %-d (no leading zero) is a glibc strftime extension, not
            # portable to Windows dev environments -- build the label by
            # hand instead of relying on it.
            dt = m["meeting_date"]
            label = f"{month_name[dt.month]} {dt.day}, {dt.year}" if dt else "recently"
            minutes_text = m["raw_data"]["minutes_text"]
            slug = f"meeting-followup-{m['id']}"
            title = prefix_town_name(f"What happened at {body}, {label}", cfg["display_name"])

            text, generated_by, verified = generate(cfg, body, label, minutes_text)

            if args.dry_run:
                print(f"\n{'='*70}\nSLUG: {slug}\nTITLE: {title}\nGENERATED_BY: {generated_by}\n{'='*70}\n{text}")
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO stories
                        (town_id, title, slug, body, source_type, source_url,
                         generated_by, verified, published_at, occurs_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (town_id, slug) DO NOTHING
                    """,
                    (town_id, title, slug, text, SOURCE_TYPE,
                     m["minutes_url"] or m["agenda_url"],
                     generated_by, verified, datetime.now(timezone.utc), m["meeting_date"]),
                )
            conn.commit()
            published += 1
            print(f"  {slug}: publicerad ({generated_by})")

        if not args.dry_run:
            print(f"\nTotalt: {published} follow-up{'s' if published != 1 else ''} publicerade")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
