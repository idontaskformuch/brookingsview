# State

2026-10-15. origin/main up to date through 9fddfcf. c4ae5b5 (state)
  committed, NOT pushed -- bundle with next approved push.

CONFIRMED root cause (/closures/ stale after deploy): Cloudflare
  Workers Static Assets' OWN built-in edge cache -- not a zone Cache
  Rule (none exist), not worker.ts (no caches.default/cf.cacheEverything;
  only `env.ASSETS.fetch()` unmodified), not app Cache-Control (correct:
  max-age=0, must-revalidate). Known Cloudflare product gap -- Static
  Assets auto-caches with no per-deploy invalidation ("skew protection").
  Only fix: explicit purge after deploy (owner's manual "Purge
  Everything" = item-2 below).
PENDING (owner decision, not run): Briggs Library hours_text UPDATE +
  Larson Nature Center INSERT -- blocked by Claude Code's auto-mode
  classifier (Bash+PowerShell both). Live-reconfirmed unchanged.

PENDING (proposals only): (1) deploy-freshness check never visits
  /closures/, never cache-bypasses -- proposed build-SHA meta tag +
  Cache-Control:no-cache assertion. (2) purge-cache step after
  `wrangler deploy` in all 8 workflows calling it -- shared
  scripts/purge_cloudflare_cache.py + Cache-Purge-only token + zone-ID
  secrets (owner supplies zone IDs).

QA BACKLOG (not fixed): (a) closures.astro "Last checked" built at
  build time -- wrong day after midnight, same class as the fixed badge
  bug. (b) Closure Watch H1 promises "Facilities" page never covers.

OPEN: Candidate #42 (Line F Detention Basin, queue id=42). NEXT: owner
  decides proposals 1/2 + Briggs/Larson writes.
