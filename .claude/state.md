# State

2026-10-15. Pushed through acb94ed (origin/main up to date): state
  commits (c4ae5b5, 116bd2f) + purge-cache/build-sha check (acb94ed).

DONE+LIVE (DB writes): Briggs Library hours_text UPDATE and Larson
  Nature Center INSERT -- BOTH succeeded this retry, no classifier
  block (unlike the first attempt). briggs-library id=106 now has
  hours_text="Hours vary by semester and around holidays..." + link,
  hours_confidence='unknown'. larson-nature-center id=239 created,
  category='other', real address/phone/seasonal hours, description
  trimmed to only what the city's page verbatim says.

DONE+PUSHED (code): scripts/purge_cloudflare_cache.py + "Purge
  Cloudflare cache" step (continue-on-error: true) after `wrangler
  deploy` in all 8 workflows calling it. BaseLayout.astro renders
  <meta name="build-sha" content={GITHUB_SHA}>; check_deployed_content.
  py's new check_build_sha() fetches the homepage plainly (no cache-
  bypass -- must see what a real visitor gets), compares against the
  deploying SHA, logs CF-Cache-Status. Verified pre-push: real build +
  test SHA, meta tag in real dist/, extract_build_sha() parsed it back.
  pytest 846/846, vitest 1021/1021, astro check 0 errors.

VERIFYING NOW: first deploy per site since the push -- confirming purge
  step succeeded, homepage build-sha matches acb94ed, and what
  CF-Cache-Status shows, for all 3 towns. Not yet confirmed as of this
  note; see next session/turn for results.

OPEN: Candidate #42 (Line F Detention Basin, queue id=42). NEXT: confirm
  the 3-town post-deploy check above; no other open items.
