#!/usr/bin/env bash
# wrangler deploy with 2 retries (owner 2026-10-27): a Cloudflare API hiccup (e.g. 25 Oct 12:00Z, code 10013 on
# assets-upload-session) must not cost a whole scrape/build cycle. Usage: bash ../scripts/wrangler_deploy_retry.sh --env <name>
# Run from site/. DEPLOY_RETRY_PAUSE (seconds, default 30) and DEPLOY_CMD (default "npx wrangler deploy") exist for the test.
set -u
# A local launch preview of Glasgow (scripts/glasgow_preview_build.sh, noindex OFF) must never be deployed.
if [ -f dist/.launch-preview ]; then
  echo "refusing to deploy: dist/ is a local launch preview (dist/.launch-preview exists). Rebuild normally first." >&2
  exit 4
fi
# IndexNow (owner 2026-11-03, scripts/indexnow.py): prepare before the deploy (diff against the live manifest), ping after a
# successful one. Best effort: neither step can change the exit code. INDEXNOW_SKIP=1 turns both off.
indexnow_env=""
prev=""
for a in "$@"; do [ "$prev" = "--env" ] && indexnow_env="$a"; prev="$a"; done
indexnow() {
  [ -n "$indexnow_env" ] && [ "${INDEXNOW_SKIP:-}" != "1" ] && command -v python >/dev/null 2>&1 || return 0
  (cd .. && python -m scripts.indexnow "$1" --env "$indexnow_env" --dist site/dist) || echo "indexnow $1 failed (ignored)" >&2
}
indexnow prepare
pause="${DEPLOY_RETRY_PAUSE:-30}"
cmd="${DEPLOY_CMD:-npx wrangler deploy}"
attempt=1
max=3
while true; do
  # shellcheck disable=SC2086
  $cmd "$@"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    [ -n "$indexnow_env" ] && sleep "${INDEXNOW_DELAY:-20}"  # let the edge serve the new HTML before crawlers are told
    indexnow ping
    exit 0
  fi
  if [ "$attempt" -ge "$max" ]; then
    echo "wrangler deploy failed after $attempt attempts (exit $rc)" >&2
    exit "$rc"
  fi
  echo "wrangler deploy failed (exit $rc), attempt $attempt of $max; retrying in $((pause * attempt))s" >&2
  sleep $((pause * attempt))
  attempt=$((attempt + 1))
done
