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

## Ongoing: scheduled GitHub Actions workflows need real activity to survive

**Why this matters**: GitHub automatically disables a repository's
**scheduled** (`on: schedule`) workflows after **60 days with no repository
activity** (pushes, PRs, etc. all count). This repo went public 2026-08-27
— scheduled workflows are free to run on public repos, same as before, but
the 60-day auto-disable rule applies regardless of visibility. A quiet
stretch (no commits, but the site otherwise "just running" on its crons)
is exactly the scenario this rule is designed to catch you out on.

**Symptom if it happens**: every `*-scrape.yml`/`*-daily-content.yml`/etc.
simply stops firing, with no notification — this looks identical to the
2026-08-27 pipeline outage (see git history around that date) except the
cause would be entirely different (GitHub-side auto-disable vs. whatever
the real 2026-08-27 cause turns out to be).

**Mitigation**: any commit to the repo (from any workflow's own bot commits,
like `daily-content.yml`'s illustration commits, or a manual push) resets
the 60-day clock. In practice, the daily illustration commits already do
this automatically as long as content generation itself is running — but
that's a coincidental side effect, not a designed safeguard. If a github.com
notification ever says a scheduled workflow was disabled, re-enable it from
the repo's Actions tab (Actions → select the workflow → "Enable workflow")
— no code change needed, GitHub just needs a human to confirm it back on.
