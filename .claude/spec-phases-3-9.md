# Spec: Phases 3–9 (updated after Phases 0–2)

Save this file as `.claude/spec-phases-3-9.md`, add "Current spec: .claude/spec-phases-3-9.md (read only the current phase)" to `.claude/state.md`, and commit it with the first Phase 3 commit. Rules in `CLAUDE.md` apply (state file, targeted tests while working, full verification once before each commit, one session at a time, no push and no live-DB write without owner approval, dry-run first).

## Goal and principles

Mediavine Journey (1,000 sessions/30 days, GA-verified, original audience-first content). The sites are 2–3 months old and traffic is low; the owner wants real value, not SEO tricks and not AI fluff. Time is part of the plan. Cheap, correct, useful beats big.

## Lessons from Phases 0–2 (apply everywhere)

- Dates, times, prices and ages render only from structured fields, never from AI prose. Guardrail `check_no_date_time_price_age_claims` exists.
- Event dates bucket in the town's local timezone. Weekend logic goes through `weekendAnchorOffset()` / `dayIndex()`; no new date math.
- Locality: `town-boundary.ts` (Census polygon, straight-line distance, no routing API, no new paid services). Uncertain locality is "unknown", never "nearby". Unknown events still appear in normal lists.
- Empty data renders as nothing. Never invent a field. Official sources only for facility data.
- Sitemap and noindex must stay disjoint on every change (`verify_sitemap_noindex_disjoint.mjs`, all three towns, sequential builds in isolated outDirs).
- Redirects live in `worker.ts` via `facility-redirects.json`; deploy and verify a redirect with `curl` BEFORE deleting the DB row it covers.
- Thin facility pages (no address, phone or hours) are noindex (gate exists). Do not mass-create pages.
- Broomfield has no clean events source (all blocked). It gets zero events until the owner says otherwise.
- Event detail pages stay noindex. Named annual events only get an indexable series page by owner decision (proposal in state.md).

## Phase 3 — Event ↔ facility hub (all towns)

- Event detail → the venue's facility page (via the places registry) with address and structured hours where they exist.
- Facility page → "Upcoming here": next 5 events at this venue plus a link to more.
- Event detail → "Other events at this venue" and "Also this weekend nearby" (in-town first, uses locality classification).
- Fold into `getRelatedContent()`; no parallel system.
- Many Brookings events have no venue name (source feeds don't carry one). Those simply don't link. Show nothing, never junk.
- Do not create facility pages from event venues. If a frequent venue has no page, list it for the owner.

Done when: a library event links to the library page, the library page lists its upcoming events, no empty sections render, sitemaps unchanged except intended changes, full verification passes.

## Phase 4 — Add to calendar

- "Add to calendar" per event → standards-compliant `.ics` (VEVENT, correct TZID, location, description, source URL), built from structured fields only.
- Generate in `site/server/worker.ts` or at build time for upcoming events only. Pages-style `functions/` routing does not run here. Keep `.ics` URLs out of sitemaps and out of the index.
- Validate against the iCal spec; timezone correctness is the main risk (test all three towns, DST boundaries, all-day events).
- Out of scope: weekly email digest (follow-up).

## Phase 5 — Small utility fixes (all towns)

- Traffic: show incidents inside the town boundary plus configured approach corridors (per-town list, e.g. I-215 and SR-60 near Moreno Valley). Everything else dropped. Empty state: "No incidents in <Town> right now" with last-checked time.
- Jobs: split "In <Town>" and "Nearby" via Adzuna location + boundary helper.
- Home Sales: computed disclosure "County records lag behind actual sales. The most recent recorded sale currently available is from <max(recording_date)>." Heading reflects the real data period.
- Sports: rename to "Local & nearby sports". New sources only if clean and robots-compliant; otherwise note it.
- About + Editorial Policy: draft only, for owner approval. Frame as an automated local information service built from public records, official calendars and public data, transparent that AI summarizes sources. Every claim must match how the system works: checks "reduce" errors, never "prevent". Describe the validation gate and source linking concretely. Remove any leaked example from another town. Privacy and cookies pages already describe Google Analytics (opt-out); keep them consistent.

## Phase 6 — Projects & Development (data-driven)

Extend the existing `projects` / `project_updates` (Story Threads); no parallel tables unless necessary.

- `/projects`: table of active projects (name, type, size, location, status, last update).
- Permanent project page: summary fields, status, timeline of updates (each linked to its source meeting/document), source documents.
- Status enum: proposed, in planning review, approved, under construction, completed, withdrawn/denied.
- Fact guardrail: every number and name on a project page must appear verbatim in the cited source text (add to the validation gate).
- New projects: AI-assisted matching only proposes candidates; a human-reviewed queue approves before going live.
- Indexable only with ≥2 updates or a substantive source document; otherwise noindex.
- Seed with existing meeting data (e.g. Aquabella in Moreno Valley) to validate the model.

## Phase 7 — Decisions

An agenda says what will be considered, not what was decided. Outcomes come only from minutes.

- Parse published minutes (eSCRIBE for Moreno Valley, AgendaLink for Broomfield, existing source for Brookings).
- Outcome enum: approved, denied, continued, adopted, received and filed, tabled, other. Never infer from an agenda or staff recommendation.
- Meeting pages show "On the agenda" (before minutes) and "Decided" (after minutes).
- Link decisions to projects where an item matches (same candidate-review rule).
- Verify against ≥5 real meetings per town by comparing extracted outcomes with the minutes text; report mismatches.

## Phase 8 — Month in <Town>

One page per month per town; all numbers computed in SQL only: decisions by outcome, projects with updates, recorded sales and median price (with lag disclosure), events in town vs nearby, incidents in town, job postings in town vs nearby. Optional short AI intro only if the validator confirms every number exists in the computed data; otherwise publish without it. Indexable once ≥4 modules have data for that month.

## Phase 9 — Multi-district Closure Watch (only if budget remains)

Fix `computeClosureWatchState` dropping a second simultaneous district's closure (tests with two districts). Investigate whether Moreno Valley needs Val Verde USD; add via config only if a public, robots-compliant closure source exists, otherwise log the finding. A full Schools section is out of scope.

## Out of scope

New AI content types or columns, mass-generated SEO pages ("10 things to do", "best restaurants"), weekly email digest, Public Safety section, Schools section, any new paid API or routing service, indexable named-event series (until the owner decides).

## Order and stopping

Do Phase 3 → 5 → 4 first (cheap, correctness and usefulness), then 6 → 7 → 8. One commit per task; stop and report after each phase (what shipped, sitemap counts before/after, open questions). Do not start the next phase without owner approval.
