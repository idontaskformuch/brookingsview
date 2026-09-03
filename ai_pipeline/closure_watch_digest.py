"""Closure Watch (/closures) -- Watch-state history accrual + optional
AI prose. See Handoff: Information Hub Tier 1, Feature A.

This module does two independent, idempotent things per run:

1. ACCRUAL (deterministic, no AI): for every CONFIRMED closure in
   school_alerts (is_closure=true) that isn't in closure_history yet, look up
   whether an NWS alert matching features.closure_watch.relevant_alert_events
   was active in the ~24h before the closure was posted, and record one
   closure_history row. This is the data min_historical_closures_for_watch
   (see configs/<town_id>.json) will eventually judge a real correlation
   against -- see that field's own config comment for why it starts inert.

2. WATCH PROSE (optional AI enhancement): if the town is currently in the
   Watch state (an active, relevant alert with no district closure notice
   yet, and not silenced by min_historical_closures_for_watch), try to
   generate a short, guardrailed paragraph of context. On any guardrail
   failure (see guardrails.validate() and guardrails.check_no_prediction()),
   this DELIBERATELY WRITES NOTHING -- no template-fallback row, unlike
   workplace_watch_digest.py's pattern. site/src/lib/db.ts's read side
   already falls back to a fully static Watch template when no
   closure_watch_prose row exists for the active alert, so "guardrail
   rejected it" and "hasn't run yet" are the same safe code path. The
   page's own hardcoded "No closure has been announced" line is NEVER
   AI-generated and never depends on this module succeeding -- see
   site/src/pages/closures.astro.

Town-generic, same as workplace_watch_digest.py -- runs against any config
whose features.closure_watch.enabled is true, no-ops otherwise.

Running:
    python -m ai_pipeline.closure_watch_digest --config configs/brookings_sd.json
    python -m ai_pipeline.closure_watch_digest --config configs/brookings_sd.json --dry-run
    python -m ai_pipeline.closure_watch_digest --config configs/brookings_sd.json --force
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
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from validation import pre_publish_check
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "closure_watch"
MAX_AGE_DAYS = 3  # matches site/src/lib/db.ts's getActiveSchoolAlerts default


def _district_public_url(cfg: dict, district: str) -> str | None:
    for src in cfg.get("data_sources", {}).values():
        if isinstance(src, dict) and src.get("type") == "school_alerts" and src.get("district") == district:
            return src.get("public_url")
    return None


def gather_confirmed_closures(conn, town_id: str, districts: list[str]) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT district, title, message, url, posted_at
              FROM school_alerts
             WHERE town_id = %s AND is_closure = true AND district = ANY(%s)
               AND posted_at >= now() - (%s || ' days')::interval
             ORDER BY posted_at DESC
            """,
            (town_id, districts, MAX_AGE_DAYS),
        )
        return [dict(r) for r in cur.fetchall()]


def gather_active_weather_alerts(conn, town_id: str, relevant_events: list[str]) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT title, venue, url, starts_at, ends_at, raw_data
              FROM events
             WHERE town_id = %s AND source = 'nws_alert' AND title = ANY(%s)
               AND (ends_at IS NULL OR ends_at >= now())
             ORDER BY starts_at DESC
            """,
            (town_id, relevant_events),
        )
        return [dict(r) for r in cur.fetchall()]


def closure_count_for_alert_event(conn, town_id: str, alert_event: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM closure_history WHERE town_id = %s AND alert_event = %s",
            (town_id, alert_event),
        )
        return cur.fetchone()[0]


def record_closure_history(conn, town_id: str, districts: list[str], relevant_events: list[str]) -> int:
    """Accrual step -- see module docstring §1. Returns rows inserted."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT sa.district, sa.url, sa.posted_at
              FROM school_alerts sa
             WHERE sa.town_id = %s AND sa.is_closure = true AND sa.district = ANY(%s)
               AND NOT EXISTS (
                     SELECT 1 FROM closure_history ch
                      WHERE ch.town_id = sa.town_id AND ch.district = sa.district
                        AND ch.closure_date = sa.posted_at::date
                   )
            """,
            (town_id, districts),
        )
        pending = [dict(r) for r in cur.fetchall()]

    inserted = 0
    for row in pending:
        with conn.cursor() as cur:
            # Alert whose active window overlaps the 24h before the closure
            # was posted -- the same "what was going on the evening before"
            # question a reader asks, just computed instead of guessed.
            cur.execute(
                """
                SELECT title FROM events
                 WHERE town_id = %s AND source = 'nws_alert' AND title = ANY(%s)
                   AND starts_at <= %s
                   AND (ends_at IS NULL OR ends_at >= %s - interval '24 hours')
                 ORDER BY starts_at DESC LIMIT 1
                """,
                (town_id, relevant_events, row["posted_at"], row["posted_at"]),
            )
            alert_row = cur.fetchone()
            alert_event = alert_row[0] if alert_row else None

            cur.execute(
                """
                INSERT INTO closure_history (town_id, district, closure_date, alert_event, source_url)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (town_id, district, closure_date) DO NOTHING
                """,
                (town_id, row["district"], row["posted_at"], alert_event, row["url"] or ""),
            )
            inserted += cur.rowcount
    return inserted


def compute_closure_watch_state(
    closures: list[dict], alert: dict | None, historical_count: int, min_required: int,
) -> dict:
    """Pure decision logic -- mirrors site/src/lib/closure-watch.ts's
    computeClosureWatchState() exactly (same three states, same
    correlation-suppression rule), kept here too so this module can decide,
    independently of the Astro build, whether Watch prose is worth
    generating right now. Separated from determine_state()'s DB fetch so it
    can be unit tested without a connection -- see tests/test_closure_watch.py.

    Confirmed always wins over Watch regardless of what alert is active (a
    district's own notice is ground truth). Watch downgrades to Clear only
    when min_required > 0 and this specific alert event hasn't met that bar
    in closure_history -- see min_historical_closures_for_watch's own
    comment in configs/<town_id>.json for why it ships inert (0) by default.
    """
    if closures:
        return {"state": "confirmed", "closure": closures[0], "alert": None, "historical_count": 0}
    if alert is None:
        return {"state": "clear", "closure": None, "alert": None, "historical_count": 0}
    if min_required > 0 and historical_count < min_required:
        return {"state": "clear", "closure": None, "alert": alert, "historical_count": historical_count}
    return {"state": "watch", "closure": None, "alert": alert, "historical_count": historical_count}


def determine_state(conn, cfg: dict) -> dict:
    """DB-fetching wrapper around compute_closure_watch_state() above."""
    feat = cfg["features"]["closure_watch"]
    town_id = cfg["town_id"]

    closures = gather_confirmed_closures(conn, town_id, feat["districts"])
    alerts = gather_active_weather_alerts(conn, town_id, feat["relevant_alert_events"])
    alert = alerts[0] if alerts else None
    historical_count = (
        closure_count_for_alert_event(conn, town_id, alert["title"])
        if (alert and alert.get("title")) else 0
    )
    min_required = _resolve_min_required(feat, alert["title"] if alert else None)
    return compute_closure_watch_state(closures, alert, historical_count, min_required)


def _resolve_min_required(feat: dict, alert_event: str | None) -> int:
    """Per-alert-event threshold lookup -- see min_historical_closures_for_watch's
    own comment in configs/<town_id>.json (a single town-wide number can't
    single out one over-triggering alert type without also suppressing a
    rarer one that should reach Watch immediately). Mirrors the identical
    lookup in site/src/lib/db.ts's getClosureWatchStatus()."""
    if alert_event is None:
        return 0
    table = feat.get("min_historical_closures_for_watch", {})
    return table.get(alert_event, table.get("default", 0))


def build_grounding_text(alert: dict, district: str, district_url: str | None, historical_count: int) -> str:
    raw = alert.get("raw_data") or {}
    parts = [
        f"ACTIVE WEATHER ALERT: {alert['title']}",
        f"Affected area: {alert.get('venue') or 'unspecified'}",
    ]
    if raw.get("headline"):
        parts.append(f"Headline: {raw['headline']}")
    if raw.get("description"):
        parts.append(f"Description: {raw['description']}")
    if raw.get("instruction"):
        parts.append(f"Public instruction: {raw['instruction']}")
    parts.append(f"School district: {district}")
    parts.append(f"District's own notification channel: {district_url or 'not on file'}")
    parts.append("District closure announcement status: NONE -- no closure has been announced.")
    if historical_count > 0:
        parts.append(
            f"Historical note: a {alert['title']} alert has preceded a confirmed "
            f"closure in this district {historical_count} time(s) on record."
        )
    return "\n".join(parts)


def build_prompt(cfg: dict) -> str:
    return build_system_prompt(cfg) + """

FORMAT OVERRIDE -- CLOSURE WATCH (Watch state):
You are writing a short (2-4 sentence) paragraph for a "Closure Watch" page.
An active weather alert is in effect, but the school district has NOT
announced any closure, delay, or cancellation.

ABSOLUTE HARD RULES (violating any of these makes the output unusable, not
just imperfect):
- NEVER state or imply that school WILL close, IS closing, or is LIKELY to
  close. No future tense, no probability language ("likely", "probably",
  "expect", "chances are", "good chance"), no imperative that assumes a
  closure ("keep the kids home", "plan for a snow day").
- Your job is to describe the CURRENT SITUATION ONLY: what alert is active,
  what it covers, and that no announcement has been made -- never to guess
  what happens next.
- If a historical note is present in the source data, you may mention it
  as a plain fact about the past ("has preceded a closure N times before"),
  never as a basis for predicting today.
- Do not tell the reader what to do beyond directing them to the district's
  own notification channel for official word.

Return ONLY the paragraph. No title, no preamble."""


def generate(alert: dict, district: str, district_url: str | None, historical_count: int,
             cfg: dict, client=None) -> tuple[str, str] | None:
    """Returns (text, generated_by) on a guardrail-passing draft, or None if
    nothing should be written (budget cap, no client, API failure, or a
    guardrail rejection surviving one retry) -- see module docstring."""
    src = build_grounding_text(alert, district, district_url, historical_count)
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
                client, model=model, max_tokens=400, system=system + extra,
                messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
            )
        except GenerationUnavailable as exc:
            print(f"  AI call failed ({exc}) -- no Watch prose this run", file=sys.stderr)
            return None
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    text = call()
    if text is None:
        return None

    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        fact_result = guardrails.validate(candidate, src, cfg)
        prediction_result = guardrails.check_no_prediction(candidate)
        violations = fact_result.violations + prediction_result.violations
        if not violations:
            # Phase 0 gate (validation/pre_publish_check.py) -- runs only once
            # the pre-existing checks pass, same retry cycle. This is
            # highest-liability content (per guardrails.py's own docstring),
            # so a Phase 0 failure gets exactly the same "write nothing, no
            # template" answer a prediction-language rejection already gets.
            violations = pre_publish_check(
                candidate, source_records=alert, cfg=cfg, content_type=SOURCE_TYPE,
            ).violations
        return not violations, violations

    passed, violations = _checks_pass(text)
    if not passed:
        text = call(
            "\n\nYour previous attempt either included a detail not found in the "
            "source, or stated/implied that school will close. Rewrite it to "
            "describe ONLY the current situation (active alert, no announcement "
            "yet) using nothing but facts from the SOURCE DATA -- no prediction, "
            "no probability language, no assumption of closure."
        )
        if text is None:
            return None
        passed, violations = _checks_pass(text)

    if passed:
        return text, f"ai:{model}"

    print("  guardrail rejection survived retry -- writing nothing, static fallback applies")
    for v in violations[:5]:
        print(f"    - {v}")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true",
                    help="regenerate Watch prose even if a row already exists for this alert")
    ap.add_argument("--dry-run", action="store_true",
                    help="run accrual + generation and print, but write NOTHING to the DB")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    feat = cfg.get("features", {}).get("closure_watch", {})

    if not feat.get("enabled"):
        print(f"Closure Watch disabled for {town_id} -- nothing to do")
        return 0

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        if args.dry_run:
            print("(dry run -- accrual skipped, it only ever inserts)")
        else:
            inserted = record_closure_history(conn, town_id, feat["districts"], feat["relevant_alert_events"])
            if inserted:
                print(f"closure_history: recorded {inserted} new closure(s)")
            conn.commit()

        status = determine_state(conn, cfg)
        print(f"Closure Watch state for {town_id}: {status['state']}")

        if status["state"] != "watch":
            return 0

        alert = status["alert"]
        district = feat["districts"][0] if feat["districts"] else ""
        district_url = _district_public_url(cfg, district)

        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM closure_watch_prose WHERE town_id=%s AND alert_url=%s",
                (town_id, alert["url"]),
            )
            exists = cur.fetchone() is not None

        if exists and not args.force:
            print("  Watch prose already generated for this alert -- skipping (use --force to regenerate)")
            return 0

        result = generate(alert, district, district_url, status["historical_count"], cfg)

        if args.dry_run:
            if result:
                print("\n" + "=" * 70)
                print(result[0])
                print("=" * 70)
            else:
                print("  no prose generated -- static fallback would apply")
            return 0

        if result is None:
            return 0

        text, generated_by = result
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO closure_watch_prose (town_id, alert_url, body, generated_by)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (town_id, alert_url) DO UPDATE SET
                    body = EXCLUDED.body, generated_by = EXCLUDED.generated_by, created_at = now()
                """,
                (town_id, alert["url"], text, generated_by),
            )
        conn.commit()
        print(f"  Watch prose written ({generated_by})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
