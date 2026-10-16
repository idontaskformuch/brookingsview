# State

2026-10-16. Everything previously pushed (HEAD=origin/main=9358540).
  This exchange: read-only investigation only, per owner's "ändra inget
  förrän du rapporterat" -- NOTHING changed, nothing committed, nothing
  built yet. Full findings reported in conversation; summarized here.

LEGISTAR raw_data OVERWRITE INVESTIGATION (read-only, this exchange):
  Scope (traced via source_snapshots history, not just current state):
    - brookings_sd/Legistar: 22 meetings missing agenda_items today.
      9 PROVEN lost (snapshot history shows a real transition from
      having items to zero, all in the SAME run: 2026-10-15 10:50 UTC,
      preceded by an unusual ~26h cron gap since the prior 10-14 08:55
      run). Ages at loss: 51-58 days -- consistent with a Legistar-side
      age threshold around that range, not our own 60-day fetch window.
      3 more (meeting_ids 226/221/212, all June dates) are unprovable --
      outside the snapshot archive's own visible window (starts 7/16),
      never seen WITH items. 10 genuinely never had items (procedural
      boards like Utility Board that apparently never get real
      Matter-linked agenda items from Legistar).
    - broomfield_co/AgendaLink: 6 missing, 0 proven lost. All 6 are
      Executive Session (closed by law, AgendaLink never exposes items
      for that meeting type -- same rule already documented for
      meeting_decisions_agendalink.py's is_eligible_board()) or one
      not-yet-happened Transition Meeting. Not a bug.
    - moreno_valley_ca/eSCRIBE: 11 missing, 0 proven lost (traced
      through 298 historical snapshots, no transition found for any).
      The "2026-10-01 mass-insert" the owner referenced (4 rows created
      at the identical millisecond 22:05:02.204983) is NOT the same bug:
      2 of the 4 (13783/13789) are CANCELLED-meeting stories, generated
      from a cancellation field, never needed agenda_items. The other 2
      (13786/13788) are DUPLICATE ROWS of two ALREADY-EXISTING meetings
      (2193/2194) -- same real eSCRIBE `ID`, different meetings.id/
      content_hash. That's a different, real bug (the same class
      db.upsert_records()'s own dedup_check_columns docstring already
      describes for a prior eSCRIBE date-parsing incident) -- flagged,
      not investigated further this pass.

  Root cause (confirmed in code, all 3 parsers): legistar_v1.py/
  agendalink_v1.py/escribe_v1.py each set raw_data["agenda_items"]/
  ["agenda_text"] ONLY when the fetch returned non-empty items, and all
  three have "raw_data" in update_columns -> db.upsert_records() does a
  blind ON CONFLICT DO UPDATE SET raw_data = EXCLUDED.raw_data (full
  replace, never a merge). The vulnerability is architecturally shared
  by all three parsers; only Legistar has PROVEN live damage so far.
  Recurs going forward (not a one-off): any meeting whose source starts
  answering empty for an event that used to have items will lose that
  data on the next scrape, and more Brookings meetings will cross the
  same ~51-58-day age threshold over time.

  Visible impact: 5 of the 9 proven-lost are the already-handled quorum
  notices (correctly skipped by yesterday's backfill -- this
  investigation independently confirms that was the right call). The
  other 7's published stories are themselves unaffected (generated
  before the loss), but meeting_decisions_legistar.py reads raw_data.
  agenda_items to find Matters to ingest decisions for -- none of these
  9 have any meeting_decisions rows (too old a meeting type to have
  Matter-linked items at all), so no confirmed decision-side damage
  yet, but it's a real latent risk for a future meeting that loses data
  before all its decisions are ingested.

  PROPOSED FIX (not built, awaiting owner go-ahead):
    - New opt-in `merge_raw_data: bool = False` param on db.upsert_
      records(). True -> SET raw_data = {table}.raw_data ||
      EXCLUDED.raw_data (jsonb shallow merge: new fetch's keys win on
      overlap, but a key only the OLD row has survives). Default False
      leaves the other ~10 existing update_columns+raw_data callers
      (traffic, sports, events, property sales, etc.) byte-for-byte
      unchanged -- zero regression risk elsewhere.
    - LegistarParser/AgendaLinkParser/EscribeParser would set
      merge_raw_data = True (class attribute, same pattern as
      conflict_columns/update_columns on BaseParser); runner.py's one
      call site reads it generically.
    - Tests proposed (not written): merge preserves old agenda_items
      when new fetch lacks it; new fetch's own agenda_items still wins
      when present; default (False) produces byte-identical SQL to
      today for every other existing caller.
    - Proposed one-off restore script (not written): for the 9 proven-
      recoverable Brookings meetings, pull the last known-good
      agenda_items/agenda_text from source_snapshots and MERGE (not
      overwrite) into current raw_data. Dry-run first. The 3 June
      meetings are likely unrecoverable (outside both the snapshot
      archive's window and Legistar's own 60-day fetch window by now).

NEXT STEP: awaiting owner's go-ahead to build the fix + tests, and to
  run the restore script's dry-run. Nothing scheduled yet.

PRE-EXISTING OPEN ITEMS, unchanged: QA finding #9 (Celebration Park
  hours, Moreno Valley, info-only, lowest priority) -- not scheduled.
