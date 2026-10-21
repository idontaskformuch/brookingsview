# qa/ -- automatic QA of the live sites

Spec: `.claude/spec-qa-automation.md`. Phases Q0-Q1.

| Pass | What | Assets |
|---|---|---|
| A | every sitemap URL, desktop light: status, console, literals, H1/title, leak | images/fonts/media blocked |
| B | ~10 key pages x desktop/mobile x light/dark: axe (WCAG A/AA), images, empty sections, client-fill, stale alerts, past events | images only in the 2 light combos |
| C | /today, /events, / with the browser clock at 07:00 / 19:00 / 23:30 town time | blocked |
| links | links outside the sitemap + external links, once each (`--links on`; workflow: Mondays) | - |

Measured 2026-10-21 (requests that really hit the sites, links off): Brookings 1 335, Moreno 1 579, Broomfield 1 118 per run
= ~4 000/day (was ~8 000 with Q0). Mondays add ~400-2 100 internal + ~400 external per town.

    python -m qa.export_blocklist                      # town_guard terms -> qa/out/blocklist.json
    node qa/web/run.mjs --town brookings_sd --limit 8  # local smoke (needs site/ npm ci; Edge/Chrome/Chromium)
    python -m qa.report --in qa/out/brookings_sd.json  # report-only unless QA_REPORT_ONLY=0

Registry: `checks.json` (id, severity, `born_from`). Waivers: `known-issues.json` (with expiry).
Rule: every manually found defect gets a registry row + a regression fixture (see CLAUDE.md).

## Keeping QA out of visitor statistics

| Where visitors are counted | What QA does | Verified |
|---|---|---|
| GA4 (`BaseLayout.astro`, loads for everyone unless consent = declined) | `bv_cookie_consent={"choice":"declined"}` is written before any page script runs, so the snippet never loads; `googletagmanager`/`google-analytics`/`doubleclick`/`googlesyndication`/`cloudflareinsights` are also aborted in the network layer | Local run 2026-10-21: 0 attempts (a `qa.tracking` finding would appear if any script ignored the consent gate) |
| AdSense (Moreno only, loads only after "Accept") | never accepts + hosts aborted | same |
| Worker `ai-crawler-log` (DB) | logs only named AI/search bots by UA; `ViewMediaQA` matches none | by reading `server/ai-crawler-log.ts` |
| Cloudflare server-side analytics (zone / Workers request counts) | **Cannot be turned off from our side**: Cloudflare counts every request to the edge. QA sends its own UA `ViewMediaQA/1.0 (+<site>/contact)` and an `x-qa-bypass` header, and writes `requests_total` (pages + subresources + link checks) into every run summary so the baseline can be subtracted | Whether the Cloudflare dashboard on this plan can filter on User-Agent or request header is NOT verified -- check Analytics -> Traffic -> Add filter (and Security -> Analytics, which lists User-Agent). If neither works, subtract `requests_total` (measured 2026-10-21 after the Q1 load cut: 1 100-1 600 per town per run, ~4 000/day in total; every run prints the per-pass counts) |

`QA_BYPASS_TOKEN` (Actions secret) is sent only to the site's own origin, never to third parties. The Cloudflare
WAF rule that lets this header through (skip bot challenge when the header equals the secret) is created by the owner
or on explicit approval via the Cloudflare API; no IP ranges.
