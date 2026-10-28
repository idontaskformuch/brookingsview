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
pause="${DEPLOY_RETRY_PAUSE:-30}"
cmd="${DEPLOY_CMD:-npx wrangler deploy}"
attempt=1
max=3
while true; do
  # shellcheck disable=SC2086
  $cmd "$@" && exit 0
  rc=$?
  if [ "$attempt" -ge "$max" ]; then
    echo "wrangler deploy failed after $attempt attempts (exit $rc)" >&2
    exit "$rc"
  fi
  echo "wrangler deploy failed (exit $rc), attempt $attempt of $max; retrying in $((pause * attempt))s" >&2
  sleep $((pause * attempt))
  attempt=$((attempt + 1))
done
