# cron-dispatcher

Cloudflare Worker (cron triggers only, no routes) that starts GitHub Actions
workflows via `workflow_dispatch`. GitHub's own `schedule:` starts jobs 4.5-9.5 h
late on this repo; Cloudflare cron fires on the minute. Background and numbers:
`.claude/state.md`, Kö 9.

| Cron (UTC) | What it dispatches |
|---|---|
| `0 11,23 * * *` | `scrape.yml`, `moval-scrape.yml`, `broomfield-scrape.yml`, `glasgow-scrape.yml` (scrape; they build and deploy only if the data changed, `scripts/ci_changed.py`) |
| `30 10-13 * * MON-FRI` | `closure-watch-morning.yml` when it is 05:30 in Chicago, `moval-closure-watch-morning.yml` when it is 05:30 in Los Angeles (DST handled in `src/schedule.ts`) |

| `*/15 * * * *` | not a workflow (on the whole hour it also writes the forecasts: NWS `/points` + forecast + hourly for the US towns, Met Office Site Specific for Glasgow, into `weather_snapshots`; the pages read them through `/api/weather`):  `src/alerts/` fetches NWS alerts (Brookings, Moreno Valley, Broomfield) and Met Office warnings (Glasgow) and writes them to the `events` table. Costs no Actions minutes. The pages read them through `/api/alerts` and `/api/weather-warnings` in the browser |

Broomfield has no morning run: its school_alerts sources are disabled.

## Token (the only secret)

Fine-grained personal access token, created by the owner:

- Resource owner: the repo owner. Repository access: **Only select repositories** -> `idontaskformuch/brookingsview`.
- Permissions: **Actions: Read and write**. Metadata: Read-only is added automatically. Nothing else.
- Expiration: 2027-10-21 (one year). The date is also a constant in `scripts/check_freshness.py` (`TOKEN_EXPIRES`); a GitHub issue opens from 2027-09-21.

```
cd cron-dispatcher
npx wrangler secret put GITHUB_TOKEN
```

An expired or wrong token makes every dispatch fail with 401/403 in the Worker's
logs, and `scrape-liveness-check.yml` (on GitHub's own schedule, independent of
this Worker) goes red after 26 h without a successful scrape (scrape runs 11:00 and 23:00 UTC).

## Live warnings (every 15 minutes) -- secrets and deploy order

The 15-minute job (warnings, and on the whole hour the forecasts) needs three more secrets on this Worker (owner steps, never committed):

```
cd cron-dispatcher
npx wrangler secret put DATABASE_URL                    # the Neon connection string (same as the GitHub secret)
npx wrangler secret put MET_OFFICE_WARNINGS_API_KEY     # Glasgow's Met Office NSWWS warnings key (same as the GitHub secret)
npx wrangler secret put MET_OFFICE_API_KEY              # Glasgow's Met Office Site Specific forecast key (same as the GitHub secret)
```

**Order matters.** Set all three secrets, then `npx wrangler deploy`. One deploy makes the 15-minute warnings AND the twice-daily scrape
go live together; the scrape drops from four runs a day to two only because warnings no longer depend on it. Verify afterwards: the
Worker's logs show `[{"townId":"brookings_sd","ok":true,...}]` every 15 minutes, and `SELECT max(created_at) FROM events WHERE source =
'nws_alert'` moves. If a town shows `ok:false`, its stored warnings stay and expire by their own end time.

## Develop

```
npm test        # schedule logic, incl. DST days
npm run check   # tsc
npx wrangler deploy --dry-run --outdir ../scratch_dry
```

Deploy (`npx wrangler deploy`) only with the owner's approval.
