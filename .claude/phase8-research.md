# Phase 8 research — "Month in &lt;Town&gt;" (no code built yet)

Read-only queries only (see scratchpad script, not committed). Snapshot taken
2026-10-14. All counts below are from the live DB.

## 1. Historical data per module × town

| Module | brookings_sd | moreno_valley_ca | broomfield_co |
|---|---|---|---|
| Decisions by outcome (`meeting_decisions`, outcome≠pending) | **Aug 2026**, real (36 total so far) | none (0 rows) | none (0 rows) |
| Projects with updates (`project_updates`) | 5 rows total, scattered May'25/Apr–Jul'26 — too thin/sparse to be a real monthly feed, looks like seed/test data | **May 2026**, real and ramping (13 total) | none (0 rows — no `projects` rows either) |
| Home sales + median (`property_sales`) | none (0 rows, no source configured) | **Jan 2024**, real, but gappy (manual/quarterly import — e.g. no Sep 2025 row at all, Oct 2025 only 2 rows = partial) | none (0 rows, no source configured) |
| Events in town / nearby (`events`) | noisy legacy rows 2022/2023, then **~May 2026** real ramp | **Jun 2026**, real ramp (also has rows out to 2028 — future/recurring imports) | only 4 rows total (Aug–Sep 2026) and per the earlier `/this-week` investigation these are NWS weather alerts, not real local events — **effectively none** |
| Traffic incidents in town (`traffic_incidents`) | none (0 rows — no public feed found, `enabled=false` by design) | **Aug 2026**, real | **Aug 2026**, real |
| Job postings in town / nearby (`jobs`) | Adzuna `posted_at` back to Dec 2024, but our own scrape (`created_at`) only starts **Aug 2026** | same shape, scrape starts **Aug 2026** | same shape, scrape starts **Aug 2026** (27th) |

Retention/purging: none found for any of these six tables. All are append-only
except `traffic_incidents`, which is mutated in place
(`ON CONFLICT ... DO UPDATE`, bumping `last_seen_at`) rather than inserted
fresh each time — a long-lived closure only shows up in the month it was
*last* seen, not every month it was active. No `DELETE` tied to age exists
anywhere in the codebase for any of these six tables (checked `grep -rn
"DELETE FROM"` across the repo — the only age-unrelated deletes are one-off
dedup scripts).

**Important nuance for Jobs:** grouping by Adzuna's own `posted_at` would
manufacture false history — we only started watching in August 2026, so a
Dec-2024-dated posting we happened to scrape in August tells us nothing about
what the job market looked like in December 2024. The Month page must group
by our own `created_at` (first-seen-by-us), never `posted_at`, or it would be
inventing coverage we don't have — the same principle Phase 8's own one-AI-
intro guardrail is built on.

**First completed month where a town clears the "≥4 modules have data" bar**
(decisions / projects / sales / events / traffic / jobs, counting only real
feeds, not the Brookings seed rows or Broomfield's alerts-only "events"):

- **moreno_valley_ca, August 2026** — projects✅ events✅ traffic✅ jobs✅ (4),
  decisions❌ sales❌ (sales data hasn't reached Aug 2026 yet, county lag).
  September 2026 clears it more comfortably.
- brookings_sd: 3 modules max today (decisions, events, jobs) — short of the
  gate until a traffic source or a real projects feed exists.
- broomfield_co: 2 modules max today (traffic, jobs, both partial-month) —
  short of the gate until a real events source and city-hall data exist.

This matches the instruction to build Moreno Valley first (it has the most
data) and confirms it's also the only town that can go indexable soon.

## 2. Relationship to the existing home-sales digest

`ai_pipeline/home_sales_digest.py` already publishes an AI-written monthly
article per calendar month ("Moreno Valley home sales: what sold in
<Month Year>"), as a `stories` row of `source_type='home_sales_digest'`, with
its own archive at `/home-sales/archive/`. It is moreno_valley_ca-only
(matches `property_sales`'s own town coverage) and re-runs/updates a month's
digest whenever a new quarterly import changes that month's data.

**Recommendation: link, don't replace.**
- Phase 8 is explicitly numbers-only/no-AI in v1; the existing digest is the
  only AI-written editorial content for this topic and has its own SEO
  equity (`/home-sales/archive/`, its own slug pattern). Replacing it would
  be a real regression, not a cleanup.
- Two of three towns have zero `property_sales` rows, so there's nothing to
  replace there anyway — the Month page's sales module would just render
  "No recorded sales data for &lt;Town&gt;" for Brookings/Broomfield.
- For Moreno Valley, the Month page's sales module (count + median + the
  existing lag-disclosure sentence, reusing `home-sales.astro`'s own wording)
  should link out to that month's digest article when one exists, and the
  digest/archive should link back to the Month page for the same month —
  the same bidirectional pattern `home-sales` already has as a secondary
  spoke of the `civic` cluster.

## 3. URL structure, linking, publishable months

**Routes** (new nested section, not a `stories` row — this is build-time SQL,
not AI content, so it doesn't belong in the `stories`/`/s/[slug]/` pipeline):

- `/month-in-town/` — hub + archive, newest first (mirrors
  `/home-sales/archive/`'s list shape).
- `/month-in-town/2026-08/` — one page per town per month, slug = `YYYY-MM`
  (same pattern as `home-sales-digest-2026-06`).

**Where it's linked from:**
- Footer "City" group in `BaseLayout.astro`, alongside `/home-sales/`,
  `/city-hall/`, `/traffic/`.
- `clusters.ts`: register `month-in-town` and `month-in-town/detail` as a
  primary spoke of `civic` (it's fundamentally a city-recap page) and a
  secondary spoke of `whats_happening`, `getting_around`, and
  `work_and_money` — exactly the shape `home-sales` already uses for its one
  secondary membership in `civic`.
- Small teaser links added to `/city-hall/archive/`, `/home-sales/archive/`,
  `/traffic/`, `/jobs/`, `/events/past/` pointing at the latest available
  Month page ("See the full month in review →").
- Inside the Month page itself, every module number links back out to its
  own full page (decisions → city hall, sales → home-sales, etc.) — the page
  is a summary/index, not competing content.

**Publishable months:** only fully completed calendar months, gated the same
way `calendarDayDiff`/`occurs_at` handling already works elsewhere — a month
is eligible once `now() >= first day of next month` in the town's own
timezone. As of 2026-10-14, September 2026 is the newest eligible month;
October 2026 must stay unpublished until 2026-11-01. `getStaticPaths` should
simply never generate a path for the current or a future month, the same way
`home_sales_digest.py` only ever iterates months that already have rows.

**Noindex gate:** per the instruction, noindex until ≥4 of the six modules
have at least one real row for that town+month — needs its own small check
function (same shape as `clusters.ts`'s `shouldNoindexStory`), fed by the six
module counts computed for the page. Given section 1 above, this means
Brookings and Broomfield pages will stay noindexed for a while yet (3 and 2
modules respectively today) — worth knowing going in, not a bug to chase.

## 4. No-AI template sentences (v1)

One sentence per module, built from a template string + the SQL numbers —
no model call. Draft examples:

- Decisions: "{n} decisions were made in {month}: {approved} approved,
  {denied} denied, {continued} continued."
- Projects: "{n} projects received an update this month."
- Home sales: "{n} homes sold in {town} this month; the median price was
  {median}." + the existing lag-disclosure sentence from `home-sales.astro`
  when the month itself has no rows yet.
- Events: "{n} events took place in {town} this month ({nearby} more
  nearby)."
- Traffic: "{n} incidents were recorded on {town}'s roads this month."
- Jobs: "{n} job postings appeared in {town} this month ({nearby} nearby)."

A module with zero rows for that town (ever, not just that month) renders
nothing — same "empty renders as nothing" rule as everywhere else, not a
templated zero-sentence.

## Next step

Build Moreno Valley only, starting with August or September 2026, after
owner approval. Noindex until ≥4 modules clear the gate (MV already clears
4 for both those months).
