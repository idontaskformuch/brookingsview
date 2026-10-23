# cron-dispatcher

Cloudflare Worker (cron triggers only, no routes) that starts GitHub Actions
workflows via `workflow_dispatch`. GitHub's own `schedule:` starts jobs 4.5-9.5 h
late on this repo; Cloudflare cron fires on the minute. Background and numbers:
`.claude/state.md`, Kö 9.

| Cron (UTC) | What it dispatches |
|---|---|
| `0 */6 * * *` | `scrape.yml`, `moval-scrape.yml`, `broomfield-scrape.yml`, `glasgow-scrape.yml` (scrape only) |
| `30 10-13 * * MON-FRI` | `closure-watch-morning.yml` when it is 05:30 in Chicago, `moval-closure-watch-morning.yml` when it is 05:30 in Los Angeles (DST handled in `src/schedule.ts`) |

Broomfield has no morning run: its school_alerts sources are disabled.

## Token (the only secret)

Fine-grained personal access token, created by the owner:

- Resource owner: the repo owner. Repository access: **Only select repositories** -> `idontaskformuch/brookingsview`.
- Permissions: **Actions: Read and write**. Metadata: Read-only is added automatically. Nothing else.
- Expiration: 90 days. The date is recorded in `.claude/state.md` under "Gällande beslut".

```
cd cron-dispatcher
npx wrangler secret put GITHUB_TOKEN
```

An expired or wrong token makes every dispatch fail with 401/403 in the Worker's
logs, and `scrape-liveness-check.yml` (on GitHub's own schedule, independent of
this Worker) goes red after 18 h without a successful scrape.

## Develop

```
npm test        # schedule logic, incl. DST days
npm run check   # tsc
npx wrangler deploy --dry-run --outdir ../scratch_dry
```

Deploy (`npx wrangler deploy`) only with the owner's approval.
