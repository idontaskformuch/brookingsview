# Operations runbook

Recurring manual procedures that can't be automated — either because a
source explicitly blocks automated access, or because a step genuinely
needs a human judgment call. Each entry says what to do, how often, and
what happens automatically once the manual step is done.

## Quarterly: refresh Moreno Valley property sales data

**Why manual**: `rivcoacr.org` (Riverside County Assessor) blocks AI agents
by name in `robots.txt` (`anthropic-ai`, `ClaudeBot`, `Claude-Web`, etc.) —
a deliberate policy choice by the site owner, not a technical obstacle to
route around. See `scrapers/parsers/rivco_property_sales_v1.py`'s module
docstring for the full reasoning.

**Cadence**: Riverside County publishes the Property Sales Report quarterly
(a rolling 2-year window). No fixed release day is published — check
periodically, roughly every 3 months.

**Steps**:
1. Download the current quarterly file from
   `rivcoacr.org/property-sales-report` (an `.xlsx`, ~13MB, countywide).
2. Save it into `data/property_sales/moreno_valley_ca/` (any filename,
   the parser picks the most recently modified `.xlsx` in that directory).
3. Run the reconcile:
   ```
   python -m scripts.reconcile_property_sales --config configs/moreno_valley_ca.json
   ```
   This upserts by `(town_id, pin, doc_number)` — safe to re-run, never
   duplicates rows, and heals/corrects any row whose data changed in the
   new file. It prints how many rows were inserted/updated and which
   months had changes.
4. Run the digest generator:
   ```
   python -m ai_pipeline.home_sales_digest --config configs/moreno_valley_ca.json
   ```
   This regenerates the digest for any month whose underlying row count
   changed, and re-classifies every month into `released_with_data` /
   `released_zero` / `not_yet_released` (see
   `ai_pipeline/home_sales_state.py`) purely from the new reconcile's
   coverage window — no manual "which months changed" bookkeeping needed.
5. Rebuild/redeploy the site (or wait for the next scheduled build) so the
   updated digests and any newly-`released` months go live.

**Sourcing decision (recorded 2026-08-22)**: stay on the free quarterly
Property Sales Report; do not purchase Riverside County's paid Bulk Data
Sales product. The quarterly report already produces correct digests once
reconciled, and the three-state gap handling means a lagging month shows an
honest "not yet released" note rather than a silent hole — so the main
downside of slower data (invisible gaps) is already mitigated. Revisit only
if home-sales becomes a flagship traffic driver *and* the free report's
latency proves to be a real user-facing problem, with evidence, not by
default.
