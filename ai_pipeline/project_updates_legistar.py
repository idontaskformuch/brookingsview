"""Threads Legistar Matter Histories onto Brookings City Hall project
pages -- see NEEDS-HUMAN-REVIEW.md, "Brookings -- City Hall Project Pages".

Unlike Moreno Valley's eSCRIBE pipeline (ai_pipeline/project_updates.py),
this doesn't need case-number/keyword matching against agenda text at all:
Legistar's own Matter object already threads a project's full history
across every meeting that touched it. This script just reads the real
history for each registered project's known legistar_matter_ids
(data/projects/brookings_sd.json) directly from
GET /v1/{client}/matters/{id}/histories and writes it through.

Outcome comes from MatterHistoryPassedFlagName ("Pass"/"Fail") when
present -- a real, explicit result, not inferred. When it's absent (e.g. a
First Reading, which is a real procedural step with no vote yet), the raw
MatterHistoryActionName ("read into the record") is used instead of
guessing an outcome -- still real information, just not a pass/fail one.
Only when NEITHER field has anything does a row fall back to 'pending'.

No numeric vote tally is populated here (Legistar's per-member vote detail
lives at a different endpoint keyed by EventItemId, which MatterHistories
doesn't expose directly, and a reliable ID mapping wasn't confirmed --
left null rather than guessed, same discipline as everywhere else).

Usage:
    python -m ai_pipeline.project_updates_legistar --config configs/brookings_sd.json
    python -m ai_pipeline.project_updates_legistar --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
import requests

from ai_pipeline.project_registry import status_for_outcome

WEBAPI = "https://webapi.legistar.com/v1"
FETCH_DELAY_SECONDS = 0.25


def _headers() -> dict:
    return {
        "Accept": "application/json",
        "User-Agent": os.environ.get("USER_AGENT", "brookingsview.com (contact: hello@brookingsview.com)"),
    }


def fetch_matter(client: str, matter_id: int) -> dict | None:
    r = requests.get(f"{WEBAPI}/{client}/matters/{matter_id}", headers=_headers(), timeout=30)
    if r.status_code != 200:
        return None
    return r.json()


def fetch_matter_histories(client: str, matter_id: int) -> list[dict]:
    r = requests.get(f"{WEBAPI}/{client}/matters/{matter_id}/histories", headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.json() or []


def matter_citation_url(client: str, matter_id: int) -> str:
    """The real, public Legistar detail page -- verified live: `ID=` here
    is the WebAPI's own MatterId, and Legistar's gateway.aspx redirects it
    to the correct LegislationDetail.aspx (which uses a DIFFERENT internal
    ID/GUID pair than the WebAPI returns -- a known Legistar quirk).
    Confirmed by curl against a real matter before trusting it."""
    return f"https://{client}.legistar.com/gateway.aspx?M=L&ID={matter_id}"


def _date_only_noon_utc(value: str | None) -> datetime | None:
    """MatterHistoryActionDate ("2026-04-07T00:00:00") is a pure CALENDAR
    DATE from Legistar -- always midnight, never a real time-of-day (unlike
    eSCRIBE's StartDate, a genuine meeting time). Storing that literal
    midnight as UTC and later rendering it in Central time shifts it back
    to the PREVIOUS calendar day (verified live: a real April 7 Planning
    Commission item rendered as "April 6" on the built page) -- the exact
    "meeting_date landmine" this codebase has hit before with other
    date-only sources (see db.ts's calendarDateParts / formatCalendarDate
    docs). Anchored at noon UTC instead: safe against any real US timezone
    offset (max ~10 hours) without ever crossing into the wrong day."""
    if not value:
        return None
    date_part = value.split("T")[0]
    try:
        d = datetime.strptime(date_part, "%Y-%m-%d")
    except ValueError:
        return None
    return d.replace(hour=12, tzinfo=timezone.utc)


def outcome_from_history(h: dict) -> str:
    passed = h.get("MatterHistoryPassedFlagName")
    if passed == "Pass":
        return "Approved"
    if passed == "Fail":
        return "Denied"
    action = (h.get("MatterHistoryActionName") or "").strip()
    return action.capitalize() if action else "pending"


def upsert_project_update(conn, project_id: int, matter: dict, history: dict, citation_url: str) -> bool:
    """Returns True if newly inserted (not a re-run touching an existing row).

    Deliberately NOT a plain `INSERT ... ON CONFLICT (project_id, meeting_id,
    agenda_counter)`: every Legistar-sourced row has meeting_id = NULL (see
    below), and Postgres never treats two NULLs as equal for uniqueness
    purposes -- ON CONFLICT would silently never match, and every re-run
    would insert a fresh duplicate row instead of updating the existing one.
    Caught live: a second run to pick up a bug fix left 10 rows in the table
    instead of 5. A manual existence check on (project_id, agenda_counter)
    sidesteps the NULL pitfall entirely -- agenda_counter is already globally
    unique here (see below), so it doesn't need meeting_id's help to be a
    real key.
    """
    outcome = outcome_from_history(history)
    # MatterHistoryId is a real, unique ID from Legistar's own system --
    # used as the counter here instead of the real agenda number (e.g.
    # "8.C."), which is only used for display (agenda_title/body already
    # carry the real detail). meeting_id stays NULL: these rows aren't
    # threaded through this codebase's own `meetings` table the way
    # eSCRIBE's are, Legistar's Matter/MatterHistory IDs are the real
    # identity here.
    counter = f"mh-{history['MatterHistoryId']}"
    params = {
        "project_id": project_id,
        "body": history.get("MatterHistoryActionBodyName") or matter.get("MatterBodyName") or "City Council",
        "meeting_date": _date_only_noon_utc(history.get("MatterHistoryActionDate")),
        "counter": counter,
        "title": matter.get("MatterTitle") or matter.get("MatterName") or "",
        "agenda_url": citation_url,
        "outcome": outcome,
        "source_url": citation_url,
    }
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM project_updates WHERE project_id = %s AND agenda_counter = %s",
            (project_id, counter),
        )
        existing = cur.fetchone()
        if existing:
            cur.execute(
                "UPDATE project_updates SET outcome = %(outcome)s, meeting_date = %(meeting_date)s WHERE id = %(id)s",
                {**params, "id": existing[0]},
            )
            return False
        cur.execute(
            """
            INSERT INTO project_updates
                (project_id, meeting_id, body, meeting_date, agenda_counter,
                 agenda_title, agenda_url, outcome, vote_yes, vote_no,
                 vote_abstain, vote_absent, source_url)
            VALUES
                (%(project_id)s, NULL, %(body)s, %(meeting_date)s, %(counter)s,
                 %(title)s, %(agenda_url)s, %(outcome)s, NULL, NULL, NULL, NULL,
                 %(source_url)s)
            """,
            params,
        )
        return True


def recompute_project_status(conn, project_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT outcome FROM project_updates WHERE project_id = %s ORDER BY meeting_date DESC LIMIT 1",
            (project_id,),
        )
        row = cur.fetchone()
        outcome = row[0] if row else "pending"
        cur.execute(
            "UPDATE projects SET status = %s, updated_at = now() WHERE id = %s",
            (status_for_outcome(outcome), project_id),
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    client = cfg["data_sources"]["city_meetings"]["client_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, slug, legistar_matter_ids FROM projects WHERE town_id = %s", (town_id,)
            )
            projects = [{"id": r[0], "slug": r[1], "matter_ids": r[2] or []} for r in cur.fetchall()]

        if not projects:
            print("  inga projekt registrerade för den här orten (se data/projects/)")
            return 0

        new_updates = 0
        touched_project_ids: set[int] = set()

        for project in projects:
            for matter_id in project["matter_ids"]:
                matter = fetch_matter(client, matter_id)
                time.sleep(FETCH_DELAY_SECONDS)
                if matter is None:
                    print(f"  VARNING: matter {matter_id} ({project['slug']}) kunde inte hämtas -- hoppar över")
                    continue

                histories = fetch_matter_histories(client, matter_id)
                time.sleep(FETCH_DELAY_SECONDS)
                citation_url = matter_citation_url(client, matter_id)

                for h in histories:
                    if args.dry_run:
                        print(f"  {project['slug']}: {h.get('MatterHistoryActionBodyName')} "
                              f"{h.get('MatterHistoryActionDate')} -> {outcome_from_history(h)}")
                        continue
                    inserted = upsert_project_update(conn, project["id"], matter, h, citation_url)
                    touched_project_ids.add(project["id"])
                    if inserted:
                        new_updates += 1

        if not args.dry_run:
            for project_id in touched_project_ids:
                recompute_project_status(conn, project_id)
            conn.commit()
            print(f"\n{new_updates} new project update{'s' if new_updates != 1 else ''}, "
                  f"{len(touched_project_ids)} project{'s' if len(touched_project_ids) != 1 else ''} touched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
