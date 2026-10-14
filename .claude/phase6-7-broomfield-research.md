# Phase 6/7 generalization to Broomfield — research only, nothing built

Snapshot 2026-10-14. All DB figures are live SELECTs (read-only); the two
live HTTP probes against api.agendalink.app (documented, unauthenticated,
no robots.txt block — same basis `agendalink_v1.py`'s own docstring already
relies on) were GETs only, no state changed anywhere.

## 1. What AgendaLink actually gives us for Phase 7 (Decisions)

**Confirmed: real per-item structured outcomes exist, but through an
endpoint the current parser doesn't call yet.**

- `agendalink_v1.py`'s own docstring already flags `/api/session/minutes/{id}`
  as "not built yet." It exists and works — my first probe against it 500'd
  because I passed our internal DB `meetings.id` (e.g. `11344`) instead of
  AgendaLink's own native id, which is already sitting unused in
  `raw_data->>'id'` (a Mongo-style hex string, e.g. `69308bdbc6a6310048fecf94`
  — the same id `agendalink_v1.py` already uses for the agenda-detail call).
  Retried with that id: **200 OK**, full JSON, no auth, no blocking.
- Verified live against meeting 11344 (Sept 8/9, 2026 Regular Meeting) and
  11352 (July 28/29): each `actionTopics[]` entry (when it had a real vote)
  carries `motions[]` with `wording` (full motion sentence — mover, seconder,
  "passed 8-2 with X and Y opposed"), `motionType.name` ("To Approve"/
  "To Amend" seen so far), `votingResult` (bool), and a per-member `votes[]`
  roll call. This is richer than Legistar's own fields that
  `meeting_decisions_legistar.py` already keys off, and maps cleanly onto
  the **existing, already-generic** `meeting_decisions` table — no new
  columns needed for the content itself (see §3).
- **Confirmed live**: for the real Chipotle items (see §2), both resolutions
  **passed 8-2** (Council: `Resolution No. 2026-107`; BURA companion:
  `Resolution No. 2026-108-UR`) on 2026-09-08. This is a real, sourced
  outcome sitting in AgendaLink right now, currently invisible to the site.
- **Delay, meeting → outcome available** (status field on the session,
  confirmed live across 25 recent sessions): `status` moves
  `published → review → completed/minutes`. Only **Regular/Special
  Meetings** ever reach `minutes` (where the real vote data lives) — Study
  Sessions, Workshops and Executive Sessions stay at `completed` forever
  (confirmed in the minutes JSON's own text: "Council takes no official
  action during Study Sessions therefore minutes are n[ot taken]"). Observed
  lag: the Sept 9 meeting reached `minutes` by Oct 14 (~5 weeks); the Sept 23
  meeting was still `review` after 3 weeks. **Estimate 3–6 weeks**, not
  instant — this is a snapshot of current `status` values, not a measured
  timestamp history, so treat it as directional.
- Practical implication for the ingest script: only process sessions whose
  `board` is a Regular or Special Meeting (or, more robustly, whose
  `status == 'minutes'`) — Study Sessions/Workshops/Executive Sessions never
  have votes, by design, not a bug to work around.

**Open issue, needs a decision before building, not solved by this research:**
`meeting_decisions.event_item_id` is `BIGINT NOT NULL UNIQUE` — a Legistar
`EventItemId`. AgendaLink's native per-topic `_id` is a Mongo ObjectId hex
string, not a number. Three options, not chosen here: (a) widen
`event_item_id` to `TEXT` (schema change, touches Brookings' 84 existing
rows — needs owner sign-off per rule 7, even though it's additive in spirit);
(b) add a separate nullable `source_item_id TEXT` and leave `event_item_id`
Legistar-only; (c) synthesize a numeric surrogate (hash). No code written for
any of these.

## 2. Broomfield's project queue — the 4 real candidates

`project_new_candidate_queue` already has exactly 4 pending_review rows for
`broomfield_co` (created 2026-09-06, via the existing **generic**
`project_updates.py` AI-candidate path — this already runs for Broomfield
today; nothing new had to be built to get this far):

| # | Title | Source item | Recommendation |
|---|---|---|---|
| 20 | Adding Fiscal Impact Review Criteria for Rezoning/PUD Plans/USRs (**Ordinance No. 2306**) | meeting 11352, 2026-07-28 | **Reject.** City-wide code/process amendment, no site, no address — not a development project in Phase 6's sense (name/type/size/**location**/status). |
| 21 | Broomfield's Development Review Process Overview | meeting 11350, 2026-08-03 Study Session | **Reject.** A briefing/presentation item, no case number, no project behind it. |
| 22 | Public Hearing — Palisade Park Chipotle Mexican Grill Final Plat/SDP/URSP (**Resolution No. 2026-107**) | meeting 11344, 2026-09-08 | **Approve, merged with #23** (see below). |
| 23 | BURA companion hearing, same site (**Resolution No. 2026-108-UR**) | meeting 11344, 2026-09-08 | **Approve, merged with #22** — same applicant, same 1.03-acre parcel (700 W 168th Place), same meeting, the Council resolution and its BURA/urban-renewal counterpart for one physical development. One project, two case numbers. |

Recommended single project record: title "Palisade Park Chipotle Mexican
Grill", `case_numbers: ["2026-107", "2026-108-UR"]`, initial `status:
approved` (both resolutions passed 8-2 on 2026-09-08 — see §1's live-verified
outcome), located 700 W 168th Place.

**Why the dedup doesn't recognize Broomfield's numbering (confirming the
question):** `project_registry._CASE_NUMBER_SHAPE_RE` is
`[A-Z]{2,5}\d{2}-\d{3,5}` (Moreno Valley's `PEN25-0098`/`CUP26-04` shape —
letters immediately touching a 2-digit year). Broomfield's own numbering is
structurally different: `Resolution No. 2026-107` / `Ordinance No. 2306` /
`Resolution No. 2026-108-UR` — a 4-digit year (resolutions) or a bare 4-digit
number (ordinances), with "Resolution No."/"Ordinance No." as free text
*before* the number, not letters fused to it, and an optional letter suffix
(`-UR`) *after*. The regex genuinely cannot match any of these — confirmed by
testing, and already flagged in `project_registry.has_pending_case_number_
duplicate()`'s own docstring ("Broomfield's resolution/ordinance-numbered
items... nothing here claims to cover that numbering scheme").

**Important: this gap only affects queue-level dedup (a cosmetic/efficiency
nuisance — a recurring item could queue twice before a human looks at it),
NOT real project matching.** `project_registry.match_project()` does a plain
case-insensitive substring check against each project's hand-entered
`case_numbers` list — once a human creates `data/projects/broomfield_co.json`
with `"2026-107"` in it, any future agenda item whose title contains
"2026-107" matches correctly regardless of this regex. No change is required
for real matching to work; a second, Broomfield-shaped pattern should be
OR'd into `_CASE_NUMBER_SHAPE_RE` only to fix pre-approval dedup.

## 3. How to wire Broomfield in — no parallel systems

**Phase 6 (Projects): already wired, confirmed working today.**
`ai_pipeline/project_updates.py` (generic) + `project_registry.py` (generic,
case-number substring matching) + `project_new_candidate_queue` +
`scripts/review_project_candidates.py` are town-agnostic already — proven by
the fact Broomfield's 4 real candidates got queued with zero
Broomfield-specific code. Remaining steps are data/process, not architecture:
1. Run `python -m scripts.review_project_candidates broomfield_co`, approve
   the merged Chipotle pair, reject #20/#21 (owner's call, not automated).
2. Create `data/projects/broomfield_co.json` (same shape/seed flow as the
   other two towns' files) once the first project is approved.
3. Add one OR'd pattern to `_CASE_NUMBER_SHAPE_RE` for Broomfield's
   `Resolution No. YYYY-NNN(-SUFFIX)?` / `Ordinance No. NNNN` shapes (queue
   dedup only, see §2).
4. Project-page indexability gate ("≥2 updates or a substantive source
   document") and the fact guardrail (`project_fact_check.py`, every number/
   name must appear verbatim in cited source text) are both already
   town-agnostic — they apply to any `projects`/`project_updates` row
   regardless of town the moment one exists. Nothing to build.

**Phase 7 (Decisions): rendering layer is already generic; only the
AgendaLink ingest script is missing.**
`meeting_decisions` (table), `site/src/lib/meeting-decisions.ts` (pure,
platform-agnostic functions: `partitionDecisions`, `outcomeLabel`,
`voteTallyText`, `splitOnAgenda`...) and the meeting page template
(`site/src/pages/s/[slug].astro`) only ever read the generic
`meeting_decisions` row shape keyed by `meeting_id` — confirmed nothing there
is Legistar-specific. Today **only Brookings has rows (84)** — Moreno
Valley/eSCRIBE hasn't been generalized into this table either yet, despite
the spec listing it; this isn't something this Broomfield research needs to
fix, just worth knowing it's not a Broomfield-only gap.
Needed: one new `ai_pipeline/meeting_decisions_agendalink.py`, mirroring
`meeting_decisions_legistar.py`'s shape (same outcome-priority discipline:
structured fields first — `motionType.name` + `votingResult` — free-text
`wording` only for display, never to override a structured result; skip
Study Session/Workshop/Executive Session boards; skip `templateTopic` rows,
same as the existing agenda parser already does). Reuses
`project_registry.status_for_outcome()`'s keyword logic rather than
reinventing an outcome classifier, extended to the full enum (`approved,
denied, continued, adopted, received_and_filed, tabled, other, pending`).
Resolve the `event_item_id` type question (see §1) before writing this.

**No new noindex/sitemap rules needed for either phase** — both ride the
existing per-content-type gates (project pages' own update-count gate,
meeting pages' existing noindex logic), which are already town-agnostic.

## 4. Separate finding, not part of the ask: `data_pending` digests ARE
visible in two real listing pages (not just noindexed on their own page)

Checked because it was flagged as worth a quick look, not because it's
Phase 6/7 work. **Confirmed real gap, not fixed — owner approval needed
before any change (rule 8):**

- `home_sales_digest.py` sets `published_at = now()` unconditionally for a
  `data_pending` placeholder row (same INSERT path as a real digest) —
  confirmed in code (`ai_pipeline/home_sales_digest.py` ~L584-590).
- `site/src/lib/db.ts`'s `getContentByType()` — the function both
  `site/src/pages/home-sales.astro` (the "Monthly digest" section) and
  `site/src/pages/home-sales/archive.astro` call to list digest cards —
  filters only `published_at IS NOT NULL`, never `generated_by`. Since
  `data_pending` rows satisfy that filter, **they render as real, clickable
  digest cards on both pages**, not just on their own noindexed `/s/` detail
  page.
- Previously confirmed (Phase 8 session): the *detail* page
  (`s/[slug].astro`) and the sitemap mirror (`astro.config.mjs`) both
  already correctly exclude `data_pending` — that was never in question.
  What's newly confirmed here is that the **list/archive surfaces don't
  share that exclusion**, so a real visitor browsing `/home-sales/` or
  `/home-sales/archive/` sees placeholder "Covering <month>" cards for
  months with no real sales data yet (currently 11 such rows per the Phase 8
  session's count).
- Not checked exhaustively: other generic feeds that also call
  `getContentByType`/similar on `home_sales_digest` or other `data_pending`-
  capable source types (homepage curation, `/month/` already has its own
  explicit filter and is fine) — worth a second pass if/when this gets
  fixed, not assumed clean.
- **Proposed fix (not applied):** add `generated_by != 'data_pending'` to
  `getContentByType()`'s WHERE clause (or to the two call sites) — mirrors
  the filter `month/[slug].astro` already applies by hand. Waiting for
  owner go-ahead per CLAUDE.md rule 8 ("ändra inget förrän jag godkänt").
