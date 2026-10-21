"""Merges duplicate `meetings` rows that share one source id (Moreno Valley:
eSCRIBE raw_data->>'ID'), the cleanup half of Kö 6 (see
.claude/plan-ko6-meetings-dedup.md). The cause (content_hash drift ->
a second row per meeting) is fixed in db.upsert_records(identity_key=...).

Per group of meetings sharing one ID:
  * canonical story = the live (superseded_by_slug IS NULL) meeting story;
    if more than one is live, the OLDEST (lowest stories.id). Zero live -> abort.
  * keeper meeting = the meeting row of the canonical story, whatever its age.
  * every other live story gets superseded_by_slug = canonical slug (the
    existing 301 mechanism; scripts.generate_duplicate_story_redirects mirrors
    it into site/server/duplicate-story-redirects.json). Already-superseded
    stories keep their current target -- redirect directions are never flipped.
  * stories on the other (duplicate) meeting rows get meeting_id = NULL
    (the FK + idx_stories_meeting_id_unique would otherwise block the delete;
    publish.py's existing_meeting_ids() ignores NULL, and the rows are gone).
  * the keeper's raw_data gets keys/values it lacks from the other rows,
    agenda_url/minutes_url are only filled when the keeper has none. (Keeper-first: see build_plan -- an empty/false value in a
    fresher row never overwrites a real one.) Rescrapes since the code fix update the OLDEST row, which
    may be a duplicate, so nothing may be dropped.
  * rows hanging off the duplicate meetings are moved to the keeper (found
    2026-10-21, the first dry run: the OLD rows carry project timeline data):
      - project_updates: repointed to the keeper, except a row whose
        (project_id, agenda_counter) the keeper already has -- that one is a
        duplicate timeline entry and is deleted (it would violate
        UNIQUE (project_id, meeting_id, agenda_counter) anyway);
      - project_new_candidate_queue: all repointed (review history kept);
      - project_updates_checkpoints: repointed only if the keeper has none,
        otherwise dropped (it is the dupe's own processed-agenda marker).
  * the duplicate meeting rows are deleted.
Aborts (nothing written) if a duplicate row is referenced by any table this
script does not know how to move, or if any check after the writes fails
(single transaction).

Usage:
    python -m scripts.merge_duplicate_meetings_by_source_id            # dry run
    python -m scripts.merge_duplicate_meetings_by_source_id --apply     # writes (LIVE DB)
Afterwards: python -m scripts.generate_duplicate_story_redirects
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from db.db import Jsonb, _json_dumps, get_conn

TOWN = "moreno_valley_ca"
KEY = "ID"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def _rows(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def build_plan(cur) -> list[dict]:
    meetings = _rows(cur, """
        SELECT id, created_at, body, meeting_date, agenda_url, minutes_url, raw_data,
               content_hash, snapshot_id, raw_data->>%s AS src_id
          FROM meetings
         WHERE town_id = %s AND raw_data->>%s IN (
               SELECT raw_data->>%s FROM meetings WHERE town_id = %s
                GROUP BY 1 HAVING count(*) > 1)
         ORDER BY id""", (KEY, TOWN, KEY, KEY, TOWN))
    stories = _rows(cur, """
        SELECT id, slug, meeting_id, published_at, superseded_by_slug
          FROM stories WHERE town_id = %s AND source_type = 'meeting'
           AND meeting_id = ANY(%s) ORDER BY id""", (TOWN, [m["id"] for m in meetings]))
    plan = []
    for src_id in sorted({m["src_id"] for m in meetings}):
        ms = [m for m in meetings if m["src_id"] == src_id]
        ids = {m["id"] for m in ms}
        ss = [s for s in stories if s["meeting_id"] in ids]
        live = [s for s in ss if s["superseded_by_slug"] is None and s["published_at"]]
        if not live:
            raise SystemExit(f"ABORT: group {src_id} has no live story")
        canonical = min(live, key=lambda s: s["id"])
        keeper_id = canonical["meeting_id"]
        dupes = [m["id"] for m in ms if m["id"] != keeper_id]
        ordered = sorted(ms, key=lambda m: (m["snapshot_id"] or 0, m["id"]))
        # Keeper-first merge: the keeper's own values win; a key the keeper lacks
        # (or holds empty/false) is filled from the freshest row that has a truthy
        # value. A fresher row's EMPTY value ('' / false / []) never overwrites a
        # real one (13789 and 13783 hold HasAgenda=false, Url='' where the older
        # keeper has the real values). Truthy-vs-truthy disagreements keep the
        # keeper's value and are listed in the dry run ("kept_conflicts").
        keeper_row = next(m for m in ms if m["id"] == keeper_id)
        merged = dict(keeper_row["raw_data"] or {})
        kept_conflicts = set()
        for m in ordered:
            if m["id"] == keeper_id:
                continue
            for k, v in (m["raw_data"] or {}).items():
                if k not in merged or (not merged[k] and v):
                    merged[k] = v
                elif v and merged[k] != v:
                    kept_conflicts.add(k)
        freshest = {c: next((m[c] for m in reversed(ordered) if m[c] is not None), None)
                    for c in ("agenda_url", "minutes_url", "snapshot_id")}
        pus = _rows(cur, "SELECT id, project_id, agenda_counter, meeting_id FROM project_updates "
                         "WHERE meeting_id = ANY(%s) ORDER BY id", (list(ids),))
        keeper_keys = {(r["project_id"], r["agenda_counter"]) for r in pus if r["meeting_id"] == keeper_id}
        pu_dup = [r for r in pus if r["meeting_id"] in dupes
                  and (r["project_id"], r["agenda_counter"]) in keeper_keys]
        pu_move = [r for r in pus if r["meeting_id"] in dupes and r not in pu_dup]
        cur.execute("SELECT count(*) FROM project_new_candidate_queue WHERE meeting_id = ANY(%s)", (dupes,))
        cand = cur.fetchone()[0]
        cur.execute("SELECT meeting_id FROM project_updates_checkpoints WHERE meeting_id = ANY(%s)", (list(ids),))
        ck = sorted(r[0] for r in cur.fetchall())
        ckpt = ("keeper has one; dupes' dropped" if keeper_id in ck
                else (f"repoint {ck[-1]} -> keeper" if ck else "none"))
        plan.append({
            "relink": {"pu_dup": pu_dup, "pu_move": pu_move, "cand": cand, "ckpt": ckpt,
                       "ckpt_src": None if keeper_id in ck or not ck else ck[-1]},
            "src_id": src_id, "keeper": keeper_id, "dupes": dupes, "canonical": canonical,
            "newly_superseded": [s for s in live if s["id"] != canonical["id"]],
            "detach": [s for s in ss if s["meeting_id"] in dupes],
            "merged": merged, "freshest": freshest, "kept_conflicts": sorted(kept_conflicts),
            "keeper_row": next(m for m in ms if m["id"] == keeper_id), "rows": ms, "stories": ss,
        })
    return plan


HANDLED_REFS = {"project_updates.meeting_id", "project_new_candidate_queue.meeting_id",
                "project_updates_checkpoints.meeting_id"}


def foreign_refs(cur, dupe_ids: list[int]) -> dict[str, int]:
    """Rows in tables OTHER than stories that reference a duplicate meeting."""
    cons = _rows(cur, """
        SELECT conrelid::regclass::text AS tbl, a.attname AS col
          FROM pg_constraint c JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.contype = 'f' AND c.confrelid = 'meetings'::regclass""")
    out = {}
    for c in cons:
        if c["tbl"] == "stories":
            continue
        cur.execute(f"SELECT count(*) FROM {c['tbl']} WHERE {c['col']} = ANY(%s)", (dupe_ids,))
        out[f"{c['tbl']}.{c['col']}"] = cur.fetchone()[0]
    return out


def describe(plan: list[dict]) -> None:
    for g in plan:
        c = g["canonical"]
        print(f"\nGroup {g['src_id']}: KEEP meeting {g['keeper']} (canonical story {c['id']} {c['slug']})")
        print(f"  delete meetings {g['dupes']}")
        for s in g["newly_superseded"]:
            print(f"  story {s['id']} {s['slug']}: LIVE -> superseded_by_slug={c['slug']}")
        for s in g["detach"]:
            print(f"  story {s['id']} {s['slug']}: meeting_id {s['meeting_id']} -> NULL"
                  f" (ends {'superseded by ' + s['superseded_by_slug'] if s['superseded_by_slug'] else 'superseded by ' + c['slug'] + ' (set above)'})")
        added = sorted(set(g["merged"]) - set(g["keeper_row"]["raw_data"] or {}))
        changed = sorted(k for k in g["merged"] if k in (g["keeper_row"]["raw_data"] or {})
                         and g["merged"][k] != g["keeper_row"]["raw_data"][k])
        rl = g["relink"]
        print(f"  project_updates: repoint {len(rl['pu_move'])}, delete {len(rl['pu_dup'])} duplicate timeline entries "
              f"(ids {[r['id'] for r in rl['pu_dup']]}); candidate queue repoint {rl['cand']}; "
              f"checkpoint {rl['ckpt']}")
        print(f"  keeper raw_data: +{len(added)} keys {added}, {len(changed)} empty values filled {changed}; "
              f"keeper's value KEPT over a differing one: {g['kept_conflicts']}")


def apply(cur, plan: list[dict]) -> None:
    all_dupes = [d for g in plan for d in g["dupes"]]
    for g in plan:
        slug = g["canonical"]["slug"]
        for s in g["newly_superseded"]:
            cur.execute("UPDATE stories SET superseded_by_slug = %s WHERE id = %s "
                        "AND superseded_by_slug IS NULL", (slug, s["id"]))
            assert cur.rowcount == 1, s
        cur.execute("UPDATE stories SET meeting_id = NULL WHERE meeting_id = ANY(%s)", (g["dupes"],))
        assert cur.rowcount == len(g["detach"]), g["src_id"]
        f = g["freshest"]
        cur.execute("""UPDATE meetings SET raw_data = %s, agenda_url = COALESCE(agenda_url, %s),
                       minutes_url = COALESCE(minutes_url, %s) WHERE id = %s""",
                    (Jsonb(g["merged"], dumps=_json_dumps), f["agenda_url"], f["minutes_url"], g["keeper"]))
        assert cur.rowcount == 1
    for g in plan:
        rl, k = g["relink"], g["keeper"]
        if rl["pu_dup"]:
            cur.execute("DELETE FROM project_updates WHERE id = ANY(%s)", ([r["id"] for r in rl["pu_dup"]],))
            assert cur.rowcount == len(rl["pu_dup"])
        if rl["pu_move"]:
            cur.execute("UPDATE project_updates SET meeting_id = %s WHERE id = ANY(%s)",
                        (k, [r["id"] for r in rl["pu_move"]]))
            assert cur.rowcount == len(rl["pu_move"])
        cur.execute("UPDATE project_new_candidate_queue SET meeting_id = %s WHERE meeting_id = ANY(%s)",
                    (k, g["dupes"]))
        assert cur.rowcount == rl["cand"]
        if rl["ckpt_src"] is not None:
            cur.execute("UPDATE project_updates_checkpoints SET meeting_id = %s WHERE meeting_id = %s",
                        (k, rl["ckpt_src"]))
        cur.execute("DELETE FROM project_updates_checkpoints WHERE meeting_id = ANY(%s)", (g["dupes"],))
    cur.execute("DELETE FROM meetings WHERE id = ANY(%s) RETURNING id", (all_dupes,))
    deleted = sorted(r[0] for r in cur.fetchall())
    assert deleted == sorted(all_dupes), (deleted, all_dupes)
    # --- after-checks (any failure raises -> whole transaction rolls back) ---
    cur.execute("SELECT count(*) FROM (SELECT 1 FROM meetings WHERE town_id=%s AND raw_data->>%s IS NOT NULL "
                "GROUP BY raw_data->>%s HAVING count(*) > 1) x", (TOWN, KEY, KEY))
    assert cur.fetchone()[0] == 0, "duplicate groups remain"
    for g in plan:
        cur.execute("""SELECT count(*) FROM stories WHERE town_id=%s AND source_type='meeting'
                       AND superseded_by_slug IS NULL AND published_at IS NOT NULL
                       AND (meeting_id = %s OR slug = ANY(%s))""",
                    (TOWN, g["keeper"], [s["slug"] for s in g["stories"]]))
        assert cur.fetchone()[0] == 1, f"group {g['src_id']}: expected exactly 1 live story"
        cur.execute("SELECT count(*) FROM stories s WHERE s.slug = ANY(%s) AND s.superseded_by_slug IS NOT NULL "
                    "AND NOT EXISTS (SELECT 1 FROM stories t WHERE t.slug = s.superseded_by_slug "
                    "AND t.superseded_by_slug IS NULL)", ([s["slug"] for s in g["stories"]],))
        assert cur.fetchone()[0] == 0, f"group {g['src_id']}: redirect chain or dangling target"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to the LIVE DB (default: dry run)")
    args = ap.parse_args()
    with get_conn() as conn:
        with conn.cursor() as cur:
            plan = build_plan(cur)
            if not plan:
                print("No duplicate groups.")
                return 0
            all_dupes = [d for g in plan for d in g["dupes"]]
            refs = foreign_refs(cur, all_dupes)
            print(f"{len(plan)} groups, {len(all_dupes)} duplicate meetings to delete: {sorted(all_dupes)}")
            print("References to duplicates from tables other than stories:", refs)
            unknown = {k: v for k, v in refs.items() if v and k not in HANDLED_REFS}
            if unknown:
                raise SystemExit(f"ABORT: duplicate meetings referenced by tables this script does not move: {unknown}")
            cur.execute("""SELECT conrelid::regclass::text, a.attname FROM pg_constraint c JOIN pg_attribute a
                           ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                           WHERE c.contype='f' AND c.confrelid = 'project_updates'::regclass""")
            pu_refs = cur.fetchall()
            for tbl, col in pu_refs:
                ids = [r["id"] for g in plan for r in g["relink"]["pu_dup"]]
                cur.execute(f"SELECT count(*) FROM {tbl} WHERE {col} = ANY(%s)", (ids,))
                if cur.fetchone()[0]:
                    raise SystemExit(f"ABORT: project_updates rows to delete are referenced by {tbl}.{col}")
            print("Tables referencing project_updates (checked, 0 rows hit):", pu_refs)
            describe(plan)
            if not args.apply:
                print("\nDRY RUN -- nothing written. Re-run with --apply to execute.")
                return 0
            BACKUP_DIR.mkdir(exist_ok=True)
            path = BACKUP_DIR / f"merge_duplicate_meetings_{TOWN}_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
            path.write_text(json.dumps([{k: g[k] for k in ("src_id", "rows", "stories")} for g in plan],
                                       default=str, indent=1), encoding="utf-8")
            print(f"\nBackup written: {path}")
            apply(cur, plan)
            print("APPLIED; after-checks passed. Now run: python -m scripts.generate_duplicate_story_redirects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
