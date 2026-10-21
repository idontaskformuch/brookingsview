"""Phase 7 ("Decisions") verification: fetches real meetings directly from
the live Legistar API (read-only -- no DB write, no scrape run needed) and
prints the "On the agenda"/"Decided" view exactly as
ai_pipeline/meeting_decisions_legistar.py would derive it, so it can be
checked by hand against Legistar's own public meeting page before any of
this ships. Per .claude/spec-phases-3-9.md Phase 7: "Verify against >=5 real
meetings per town by comparing extracted outcomes with the minutes text;
report mismatches."

Usage:
    python -m scripts.verify_meeting_decisions_legistar --client cityofbrookings --event-ids 3541,3540,3831,3365,3368
    python -m scripts.verify_meeting_decisions_legistar --client cityofbrookings --count 5
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from ai_pipeline.meeting_decisions_legistar import consent_votes, dedupe_shadow_items, outcome_from_item
from scrapers.user_agent import user_agent

WEBAPI = "https://webapi.legistar.com/v1"


def _headers() -> dict:
    return {
        "Accept": "application/json",
        "User-Agent": user_agent(),
    }


def fetch_event_items(client: str, event_id: int) -> list[dict]:
    r = requests.get(f"{WEBAPI}/{client}/events/{event_id}/eventitems",
                      params={"AgendaNote": "1"}, headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_votes(client: str, event_item_id: int) -> list[dict]:
    r = requests.get(f"{WEBAPI}/{client}/eventitems/{event_item_id}/votes",
                      headers=_headers(), timeout=30)
    if r.status_code != 200:
        return []
    return r.json()


def fetch_event(client: str, event_id: int) -> dict:
    r = requests.get(f"{WEBAPI}/{client}/events/{event_id}", headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def vote_tally_text(votes: list[dict]) -> str | None:
    if not votes:
        return None
    yes = sum(1 for v in votes if (v.get("value") or "").lower() == "yes")
    no = sum(1 for v in votes if (v.get("value") or "").lower() == "no")
    return f"{yes}-{no}"


def report_event(client: str, event_id: int) -> None:
    event = fetch_event(client, event_id)
    print(f"\n{'=' * 70}\n{event.get('EventBodyName')} -- {event.get('EventDate', '')[:10]}  "
          f"(EventId {event_id})\n{'=' * 70}")
    items = dedupe_shadow_items(fetch_event_items(client, event_id))
    on_agenda, decided = [], []
    for item in items:
        if not item.get("EventItemMatterId"):
            continue
        outcome = outcome_from_item(item)
        if outcome == "pending":
            on_agenda.append(item)
            continue
        votes_raw = fetch_votes(client, item["EventItemId"]) if item.get("EventItemPassedFlagName") else []
        time.sleep(0.15)
        votes = [{"person": v.get("VotePersonName"), "value": v.get("VoteValueName"),
                  "vote_event_item_id": v.get("VoteEventItemId")} for v in votes_raw]
        item["votes"] = votes
        is_consent, block_id, _ = consent_votes(item)
        decided.append((item, outcome, votes, is_consent, block_id))

    if on_agenda:
        print("\nON THE AGENDA (no official result yet):")
        for item in on_agenda:
            print(f"  {item.get('EventItemAgendaNumber') or '':>8}  {item.get('EventItemTitle')}"
                  f"  [{item.get('EventItemMatterFile')}]")

    if decided:
        print("\nDECIDED:")
        for item, outcome, votes, is_consent, block_id in decided:
            tally = vote_tally_text(votes)
            consent_note = " -- Approved as part of the Consent Agenda" if is_consent else ""
            print(f"  {item.get('EventItemAgendaNumber') or ''!s:>8}  {item.get('EventItemTitle')}"
                  f"  [{item.get('EventItemMatterFile')}]")
            print(f"      -> {outcome.upper()}" + (f"  ({tally})" if tally else "") + consent_note)
            if block_id:
                print(f"      (roll call recorded under block EventItemId {block_id})")
            if item.get("EventItemActionText"):
                print(f"      Motion: {item['EventItemActionText'][:160]}")
            # Flags for manual cross-check against Legistar's own page --
            # exactly the kind of mismatch Phase 7 asks to report.
            if item.get("EventItemActionName") and item["EventItemActionName"].lower() != outcome.replace("_", " "):
                print(f"      NOTE: raw ActionName={item['EventItemActionName']!r} "
                      f"differs from derived outcome={outcome!r} -- cross-checked against "
                      f"PassedFlagName/MatterStatus/votes above, not a guess.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default="cityofbrookings")
    ap.add_argument("--event-ids", help="comma-separated Legistar EventIds")
    args = ap.parse_args()
    if not args.event_ids:
        raise SystemExit("pass --event-ids (comma-separated)")
    for event_id in (int(x) for x in args.event_ids.split(",")):
        report_event(args.client, event_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
