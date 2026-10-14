"""Phase 7, "Decisions" (Brookings/Legistar) -- normalizes meetings.raw_data.
agenda_items (already enriched by scrapers/parsers/legistar_v1.py with
EventItemId/EventItemPassedFlagName/EventItemConsent/EventItemMatterId/votes)
into the structured meeting_decisions table, so meeting pages can render
"On the agenda" (no outcome yet) vs "Decided" (outcome + votes), per ärende,
without re-parsing JSON at render time.

Only ärenden with a real Matter attached (EventItemMatterId) are ingested --
pure procedural rows (call to order, roll call, adjourn, section headers like
"Consent Agenda:" / "Presentations/Reports:") carry no Matter and aren't
decisions a reader cares about tracking. "Action to approve the agenda" is
the one real vote this intentionally excludes from meeting_decisions for the
same reason: it's a genuine Pass/Fail vote, but routine and not substantive.

Outcome priority -- verified live against cityofbrookings 2026-10-14, event
3540/item 100490 ("Human Rights Commission appointment: Jeff Struwe"):
EventItemActionName said "approved" while EventItemPassedFlagName said
"Fail", EventItemMatterStatus said "Failed", EventItemActionText's own
narrative said "The motion failed by the following vote", and all 7 roll-call
votes were "No" -- the free-text ActionName field is, confirmed live, not
reliable on its own. passed_flag (Pass/Fail) is the primary signal; when
absent, EventItemMatterStatus ('Filed' -> received_and_filed) is used next;
only then does the free-text action_name supply a label, and only for
display ('other'), never to override a Pass/Fail flag.

Consent agenda: an item with EventItemConsent=1 whose own /votes response
resolves to a DIFFERENT EventItemId (the shared block, e.g. "Approval of the
Consent Agenda") never gets its own separate vote tally -- the block's votes
are copied onto it with consent_block_event_item_id set, and the meeting page
labels it "Approved as part of the Consent Agenda" (see
site/src/lib/meeting-decisions.ts), never as if it had its own roll call.

Usage:
    python -m ai_pipeline.meeting_decisions_legistar --config configs/brookings_sd.json
    python -m ai_pipeline.meeting_decisions_legistar --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg

OUTCOME_PENDING = "pending"


def dedupe_shadow_items(items: list[dict]) -> list[dict]:
    """A real, live-verified Legistar artifact: cityofbrookings event 3368
    ("Rezone Lot 1 of Clark 2nd Addition...", MatterId 8903, agenda number
    "6b.") posts TWO EventItems for the one real vote -- EventItemId 94873
    (the real Pass/9-0 action) and EventItemId 95301 (same MatterId, SAME
    agenda number "6b.", but ActionName/PassedFlagName/votes all null).
    Verified live three times via both the bulk eventitems listing and the
    single-item endpoint -- both share "6b." (an agenda-number-null
    heuristic was tried first and discarded: a first live check happened to
    catch 95301 mid-transient-null on Legistar's own side, which a repeat
    query immediately contradicted -- the real, stable distinguishing
    signal is the (MatterId, AgendaNumber) pair, not whether AgendaNumber
    itself is set).

    Ingesting both would show the SAME real decision twice on the meeting
    page: once correctly under "Decided" (94873), once falsely under "On
    the agenda" (95301, since outcome_from_item() on an all-null item
    resolves to 'pending'). Within one meeting, when two-or-more items
    share (MatterId, AgendaNumber) and at least one has real outcome
    signal (ActionName or PassedFlagName) while at least one other has
    neither, the signal-less ones are dropped as shadow duplicates.

    Deliberately NOT applied when EVERY item in a group has its own real
    signal (see the Planning Commission "Subdivision Regulations" case,
    MatterId 9111 in event 3365: three distinct EventItems, each with its
    own real ActionName/PassedFlagName/vote tally -- a genuine sequence of
    separate real votes on the same matter within one meeting, e.g. a
    motion failing and then a reconsidered/amended version passing. That
    is real information, not a duplicate, and all of it is kept."""
    groups: dict[tuple, list[dict]] = {}
    ungrouped: list[dict] = []
    for item in items:
        matter_id = item.get("EventItemMatterId")
        if matter_id is None:
            ungrouped.append(item)
            continue
        key = (matter_id, item.get("EventItemAgendaNumber"))
        groups.setdefault(key, []).append(item)

    result = list(ungrouped)
    for group in groups.values():
        if len(group) == 1:
            result.extend(group)
            continue
        has_signal = [g for g in group if g.get("EventItemActionName") or g.get("EventItemPassedFlagName")]
        no_signal = [g for g in group if g not in has_signal]
        # only drop the signal-less ones when at least one sibling DOES
        # have a real result -- otherwise this is ambiguous and every item
        # is kept rather than guessed away.
        result.extend(has_signal if (has_signal and no_signal) else group)
    return result


def outcome_from_item(item: dict) -> str:
    passed = item.get("EventItemPassedFlagName")
    if passed == "Fail":
        return "denied"
    if passed == "Pass":
        action = (item.get("EventItemActionName") or "").strip().lower()
        if "adopt" in action:
            return "adopted"
        if "table" in action:
            return "tabled"
        if "continue" in action:
            return "continued"
        # Default for a confirmed Pass with no more specific verb --
        # "approved"/"approved as amended"/"approved with conditions" all
        # land here, which is correct; an unrecognized verb still gets a
        # real Pass, so "approved" stays honest rather than downgrading to
        # a vague "other" for a result that IS a clear yes.
        return "approved"
    status = (item.get("EventItemMatterStatus") or "").strip().lower()
    if status == "filed":
        return "received_and_filed"
    action = (item.get("EventItemActionName") or "").strip()
    if action:
        # Real information (e.g. "presented", "read into the record",
        # "withdrawn"), just not a pass/fail outcome -- same discipline as
        # ai_pipeline/project_updates_legistar.py's outcome_from_history().
        return "other"
    return OUTCOME_PENDING


def consent_votes(item: dict) -> tuple[bool, int | None, list[dict] | None]:
    """Returns (is_consent_item, consent_block_event_item_id, votes).

    votes is always this item's OWN /votes response (already attached by
    the scraper) -- when it resolves to a different EventItemId (the shared
    consent-agenda block), that id is surfaced separately so the render
    layer can label it, never silently presented as this item's own roll
    call.
    """
    is_consent = bool(item.get("EventItemConsent"))
    votes = item.get("votes") or None
    block_id = None
    if is_consent and votes:
        voted_ids = {v.get("vote_event_item_id") for v in votes if v.get("vote_event_item_id")}
        own_id = item.get("EventItemId")
        if voted_ids and voted_ids != {own_id}:
            # all real votes seen so far point at exactly one block id
            block_id = next(iter(voted_ids - {own_id}), None) or next(iter(voted_ids))
    return is_consent, block_id, votes


def upsert_decision(conn, meeting_id: int | None, source_url: str | None, item: dict) -> bool:
    """Returns True if newly inserted. event_item_id is a real, globally
    unique Legistar id -- a plain ON CONFLICT is safe here (unlike
    project_updates' meeting_id/agenda_counter pair)."""
    is_consent, block_id, votes = consent_votes(item)
    params = {
        "meeting_id": meeting_id,
        "event_item_id": item["EventItemId"],
        # See db/migrations/055_meeting_decisions_source_system.sql --
        # every writer must set these so Migration B's later CHECK
        # (source_system/source_item_id always set) doesn't reject rows
        # this script is still writing.
        "source_system": "legistar",
        "source_item_id": str(item["EventItemId"]),
        "agenda_number": item.get("EventItemAgendaNumber"),
        "title": item.get("EventItemTitle") or item.get("EventItemMatterName") or "",
        "matter_id": item.get("EventItemMatterId"),
        "matter_file": item.get("EventItemMatterFile"),
        "matter_type": item.get("EventItemMatterType"),
        "action_name": item.get("EventItemActionName"),
        "action_text": item.get("EventItemActionText"),
        "passed_flag": item.get("EventItemPassedFlagName"),
        "matter_status": item.get("EventItemMatterStatus"),
        "outcome": outcome_from_item(item),
        "is_consent_item": is_consent,
        "consent_block_event_item_id": block_id,
        "votes": json.dumps(votes) if votes else None,
        "source_url": source_url,
    }
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO meeting_decisions
                (meeting_id, event_item_id, source_system, source_item_id, agenda_number, title,
                 matter_id, matter_file, matter_type, action_name, action_text, passed_flag,
                 matter_status, outcome, is_consent_item, consent_block_event_item_id, votes,
                 source_url, updated_at)
            VALUES
                (%(meeting_id)s, %(event_item_id)s, %(source_system)s, %(source_item_id)s,
                 %(agenda_number)s, %(title)s, %(matter_id)s,
                 %(matter_file)s, %(matter_type)s, %(action_name)s, %(action_text)s,
                 %(passed_flag)s, %(matter_status)s, %(outcome)s, %(is_consent_item)s,
                 %(consent_block_event_item_id)s, %(votes)s, %(source_url)s, now())
            ON CONFLICT (event_item_id) DO UPDATE SET
                source_system = EXCLUDED.source_system,
                source_item_id = EXCLUDED.source_item_id,
                agenda_number = EXCLUDED.agenda_number,
                title = EXCLUDED.title,
                matter_id = EXCLUDED.matter_id,
                matter_file = EXCLUDED.matter_file,
                matter_type = EXCLUDED.matter_type,
                action_name = EXCLUDED.action_name,
                action_text = EXCLUDED.action_text,
                passed_flag = EXCLUDED.passed_flag,
                matter_status = EXCLUDED.matter_status,
                outcome = EXCLUDED.outcome,
                is_consent_item = EXCLUDED.is_consent_item,
                consent_block_event_item_id = EXCLUDED.consent_block_event_item_id,
                votes = EXCLUDED.votes,
                updated_at = now()
            RETURNING (xmax = 0) AS inserted
            """,
            params,
        )
        row = cur.fetchone()
        return bool(row and row[0])


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
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, raw_data, agenda_url FROM meetings WHERE town_id = %s "
                "AND raw_data IS NOT NULL AND raw_data ? 'agenda_items' "
                "ORDER BY meeting_date DESC",
                (town_id,),
            )
            meetings = cur.fetchall()

        new_count = 0
        updated_count = 0
        skipped_no_matter = 0
        skipped_empty_shadow = 0

        for meeting_id, raw_data, agenda_url in meetings:
            raw_items = raw_data.get("agenda_items") or []
            items = dedupe_shadow_items(raw_items)
            skipped_empty_shadow += len(raw_items) - len(items)
            for item in items:
                if not item.get("EventItemId") or not item.get("EventItemMatterId"):
                    skipped_no_matter += 1
                    continue
                if args.dry_run:
                    print(f"  meeting {meeting_id}: {item.get('EventItemAgendaNumber')} "
                          f"{item.get('EventItemTitle')!r} -> {outcome_from_item(item)}")
                    continue
                inserted = upsert_decision(conn, meeting_id, agenda_url, item)
                if inserted:
                    new_count += 1
                else:
                    updated_count += 1

        if not args.dry_run:
            conn.commit()
            print(f"\n{new_count} new, {updated_count} updated, "
                  f"{skipped_no_matter} skipped (no matter attached), "
                  f"{skipped_empty_shadow} skipped (empty shadow duplicate)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
