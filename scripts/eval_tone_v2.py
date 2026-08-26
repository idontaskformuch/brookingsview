"""Summary Tone Prompts evaluation (see NEEDS-HUMAN-REVIEW.md "Summary Tone
Prompts -- scraped local items", §8): generates BOTH the old prose-blob
generator and the new tone_v2 {summary, meta} generator for the same real,
recent items, and renders two static HTML pages -- old.html/new.html -- so a
human can judge them side by side at mobile width before flipping
cfg["ai"]["tone_v2"] on for real.

"The question is not whether individual sentences improved. It is whether
the page still reads as a list." -- so both pages render as a stacked list
of items, not a single item in isolation.

COST WARNING: this makes real Anthropic API calls -- 2 generations (old +
new) per item, up to 2x(10+15+5) = 60 calls for the default sample. Same
"real paid API call, needs explicit authorization" discipline as this
project's image-generation scripts. Do not run without the user's go-ahead.

Usage:
    python -m scripts.eval_tone_v2 --config configs/moreno_valley_ca.json
    python -m scripts.eval_tone_v2 --config configs/moreno_valley_ca.json \\
        --meetings 10 --events 15 --alerts 5 --out .eval_tone_v2/
"""
from __future__ import annotations

import argparse
import html
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row
from datetime import datetime

from ai_pipeline.format_prompt import format_record
from ai_pipeline.publish import (
    _INTERNAL_FIELDS, _localize_datetime_fields, group_event_slots,
    group_recurring_events, has_substance, is_current,
)
from zoneinfo import ZoneInfo


def _fetch_sample(conn, town_id: str, n_meetings: int, n_events: int, n_alerts: int, tz: ZoneInfo) -> dict[str, list[dict]]:
    """Real, recent, substantive rows -- same has_substance()/is_current()
    gates publish.py itself applies, so the sample is representative of
    what would actually get published, not cherry-picked easy cases."""
    buckets: dict[str, list[dict]] = {"meeting": [], "event": [], "alert": []}

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT * FROM meetings WHERE town_id = %s ORDER BY meeting_date DESC LIMIT 200",
            (town_id,),
        )
        for row in cur.fetchall():
            row = dict(row)
            if len(buckets["meeting"]) >= n_meetings:
                break
            if has_substance("meetings", row):
                buckets["meeting"].append(row)

        # Alerts queried SEPARATELY from ordinary events -- a shared
        # `ORDER BY starts_at DESC LIMIT N` window is dominated by ordinary
        # events with far-future starts_at (recurring series scheduled
        # months out), which silently crowds out every alert (a short-lived
        # NWS/county row a few days out at most) no matter how large N is.
        # Confirmed live (2026-08-26): 393 real, current nws_alert rows in
        # the table, 0 of them within the top 500 events by starts_at.
        cur.execute(
            "SELECT * FROM events WHERE town_id = %s AND source IN ('nws_alert', 'county_alert') "
            "ORDER BY starts_at DESC LIMIT 100",
            (town_id,),
        )
        for row in cur.fetchall():
            row = dict(row)
            if len(buckets["alert"]) >= n_alerts:
                break
            if has_substance("events", row) and is_current("alert", row):
                buckets["alert"].append(row)

        # Grouped the same way publish.py's real pipeline does (slot- then
        # series-collapse) before sampling, then sorted ASC (nearest-first)
        # -- NOT a raw `ORDER BY starts_at DESC LIMIT N` fetch. A prolific
        # weekly series (e.g. "Shop for a Cause") gets pre-expanded ~2 years
        # out by its upstream Tockify feed; DESC-ordering raw instance rows
        # let that far-future tail alone fill the whole event sample before
        # any other real event -- or even that same series' real NEXT
        # occurrence -- got a chance (confirmed live 2026-08-26: eval output
        # showed 2028-dated "Shop for a Cause" entries instead of the actual
        # upcoming one). Grouping first also matches what a real reader
        # would see: one story per series, not 15 near-duplicate instances.
        # `starts_at >= now() - 2 days`: the events table has no purge job,
        # so old rows already published as real stories months ago (via a
        # separate known_slugs check this eval doesn't do) are still sitting
        # here -- without this bound, ASC-sorting would surface THOSE as
        # "nearest" instead of genuinely current/upcoming ones. The 2-day
        # grace (not a hard `>= now()`) just tolerates today's already-past
        # occurrences of a same-day series.
        cur.execute(
            "SELECT * FROM events WHERE town_id = %s AND source NOT IN ('nws_alert', 'county_alert') "
            "AND starts_at >= now() - interval '2 days' ORDER BY id",
            (town_id,),
        )
        event_rows = [dict(r) for r in cur.fetchall()]
        event_rows = group_event_slots(event_rows, tz)
        event_rows = group_recurring_events(event_rows, tz)
        event_rows.sort(key=lambda r: r.get("starts_at") or datetime.max)
        for row in event_rows:
            if len(buckets["event"]) >= n_events:
                break
            if has_substance("events", row) and is_current("event", row):
                buckets["event"].append(row)

    return buckets


def _to_ai_record(row: dict, tz: ZoneInfo) -> dict:
    record = {k: v for k, v in row.items() if k not in _INTERNAL_FIELDS}
    return _localize_datetime_fields(record, tz)


def _render_meta_row(meta: dict | None) -> str:
    if not meta:
        return ""
    parts = " &middot; ".join(
        f"<strong>{html.escape(k)}:</strong> {html.escape(str(v))}" for k, v in meta.items()
    )
    return f'<p class="meta">{parts}</p>'


def _render_item(title: str, kind: str, text: str, meta: dict | None, generated_by: str) -> str:
    return f"""
    <article class="item">
      <p class="kicker">{html.escape(kind)} &middot; <span class="gen">{html.escape(generated_by)}</span></p>
      <h3>{html.escape(title)}</h3>
      <p class="body">{html.escape(text)}</p>
      {_render_meta_row(meta)}
    </article>"""


_PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tone eval -- {label}</title>
<style>
  body {{ font-family: Georgia, 'Times New Roman', serif; max-width: 26rem; margin: 0 auto;
         padding: 1.5rem 1rem; background: #f4f6f7; color: #1a1a1a; }}
  h1 {{ font-family: -apple-system, sans-serif; font-size: 1.125rem; letter-spacing: 0.04em;
        text-transform: uppercase; color: #0b2e55; border-bottom: 3px solid #0b2e55; padding-bottom: 0.5rem; }}
  .item {{ border-bottom: 1px solid #ccc; padding: 0.875rem 0; }}
  .kicker {{ font-family: -apple-system, sans-serif; font-size: 0.6875rem; text-transform: uppercase;
             letter-spacing: 0.06em; color: #666; margin: 0 0 0.25rem; }}
  .gen {{ opacity: 0.6; }}
  h3 {{ margin: 0 0 0.375rem; font-size: 1.0625rem; }}
  .body {{ margin: 0; font-size: 0.9375rem; line-height: 1.5; }}
  .meta {{ margin: 0.375rem 0 0; font-size: 0.8125rem; color: #444;
           background: #fff; border-left: 3px solid #0b2e55; padding: 0.375rem 0.625rem; }}
</style>
</head>
<body>
<h1>{label} generator -- {count} items</h1>
{items}
</body>
</html>
"""


def render_page(label: str, entries: list[dict]) -> str:
    items_html = "".join(
        _render_item(e["title"], e["kind"], e["text"], e.get("meta"), e["generated_by"])
        for e in entries
    )
    return _PAGE_TEMPLATE.format(label=html.escape(label), count=len(entries), items=items_html)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--meetings", type=int, default=10)
    ap.add_argument("--events", type=int, default=15)
    ap.add_argument("--alerts", type=int, default=5)
    ap.add_argument("--out", default=".eval_tone_v2")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    old_entries: list[dict] = []
    new_entries: list[dict] = []

    with psycopg.connect(database_url) as conn:
        buckets = _fetch_sample(conn, town_id, args.meetings, args.events, args.alerts, tz)

        for kind, rows in buckets.items():
            print(f"{kind}: {len(rows)} sample row(s)")
            for row in rows:
                ai_record = _to_ai_record(row, tz)
                title = str(row.get("title") or row.get("body") or kind).strip()

                old_cfg = {**cfg, "ai": {**cfg.get("ai", {}), "tone_v2": False}}
                old_result = format_record(ai_record, kind, old_cfg)
                old_entries.append({
                    "title": title, "kind": kind, "text": old_result.text,
                    "meta": None, "generated_by": old_result.generated_by,
                })
                print(f"  old [{old_result.generated_by}]: {old_result.text[:70]}")

                new_cfg = {**cfg, "ai": {**cfg.get("ai", {}), "tone_v2": True}}
                new_result = format_record(ai_record, kind, new_cfg)
                new_entries.append({
                    "title": title, "kind": kind, "text": new_result.text,
                    "meta": new_result.meta, "generated_by": new_result.generated_by,
                })
                print(f"  new [{new_result.generated_by}]: {new_result.text[:70]}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "old.html").write_text(render_page("Old (current)", old_entries), encoding="utf-8")
    (out_dir / "new.html").write_text(render_page("New (tone_v2)", new_entries), encoding="utf-8")

    print(f"\nWrote {out_dir / 'old.html'} and {out_dir / 'new.html'} -- "
          f"open both at mobile width and compare.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
