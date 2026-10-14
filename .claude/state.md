# State

2026-10-14, 4-point follow-up round 3.

Pt1 DONE: meeting-decisions.ts gained splitOnAgenda() (pure, uses
  time.ts's calendarDayDiff) -- a 'pending' item becomes "No recorded
  outcome" once stories.occurs_at (the real meeting date, NOT
  published_at) is >60 days old. s/[slug].astro wired it in + new
  render block; 3 new tests in meeting-decisions.test.ts. Display-only,
  no new data, no DB writes. vitest 1012/1012, pytest 786/8skip,
  astro check 0 errors. Live example once deployed:
  brookingsview.com/s/meeting-2026-08-25-11005/ (event 3540, item
  100490) is the exact row flagged in round 2 Pt3 as missing a
  meeting_decisions row -- still absent, so nothing to show there yet;
  a synthetic case is in the new tests instead.
Pt2 DONE: configs/brookings_sd.json "domain" was "brookings311.com" --
  never the real domain. Confirmed write-only: only db.py's
  ensure_town() reads it (into towns.domain, itself unread anywhere).
  Real source of truth is site/src/lib/site-config.ts's SITE_URLS
  (brookingsview.com/morenovalleyview.com/broomfieldview.com, all
  correct) -- canonical/sitemap/OG/RSS/worker all read THAT, confirmed
  via ics.ts, robots.txt.ts, check_deployed_content.py's own comment
  about this exact staleness (found 2026-08-28). Fixed to
  brookingsview.com + note rewritten. broomfield_co/moreno_valley_ca's
  domain fields already correct, no change needed.
Pt3 DONE (read-only, nothing changed): (a) DEPLOY_CHECK_SECRET is a
  GitHub Actions secret only (${{ secrets.DEPLOY_CHECK_SECRET }} in all
  3 deploy.yml variants, os.environ.get() in check_deployed_content.py)
  -- no hardcoded value anywhere in the tree or git history (checked via
  git log -S). (b) One call does NOT send X-BV-Deploy-Check by design:
  the new untracked .github/workflows/cf-bot-fight-probe.yml (Pt6 from
  round 2) curls all 3 domains deliberately WITHOUT the header/secret,
  to test whether Bot Fight Mode blocks the bare request shape. Every
  other self-request (check_deployed_content.py's two requests.get()
  calls) already sends it via _request_headers().
Pt4 DONE: queried scrape_runs directly -- newest moreno_valley_ca/
  city_meetings row is still id=12435, Oct13 22:01:53 GMT, status=ok,
  docs_attempted=0, docs_failed=0 (pre-053-exercise defaults). Migration
  053 IS applied (columns exist) and escribe_v1.py's code DOES populate
  them now -- but runner.py's 24h refresh_minutes throttle means no new
  city_meetings run has fired since Oct13 22:01 (confirmed current time:
  Oct14 11:00 UTC). Next real run ~Oct14 22:01 UTC; 053's fix isn't
  observable before then, exactly as round 2 predicted.

Changed files (uncommitted): configs/brookings_sd.json,
  site/src/lib/meeting-decisions.ts, meeting-decisions.test.ts,
  site/src/pages/s/[slug].astro.

Next: commit locally (not pushed, per rule 6). Re-check MV scrape_runs
  after ~22:01 UTC today for the real 053 verification. cf-bot-fight-
  probe.yml still untouched/uncommitted per round 2 Pt6, owner's call.
