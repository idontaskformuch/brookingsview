#!/usr/bin/env bash
# wrangler deploy with up to 5 retries (owner 2026-10-27, widened 2026-11-06): a Cloudflare API hiccup (e.g. 25 Oct 12:00Z, code
# 10013 on assets-upload-session; 6 Nov 09:30Z, 503 on all 3 attempts) must not cost a whole scrape/build cycle.
# Backoff 30, 60, 120, 240, 480 s (DEPLOY_RETRY_PAUSE is the first wait, doubled each time; a printed Retry-After raises a wait, max 900 s). Only a 5xx or 429 from the API or a
# network error is retried; any other 4xx (auth/config) or output we do not recognise fails at once, so a bad token is not retried
# for 15 minutes. Usage: bash ../scripts/wrangler_deploy_retry.sh --env <name>
# Run from site/. DEPLOY_RETRY_PAUSE (seconds, default 30) and DEPLOY_CMD (default "npx wrangler deploy") and DEPLOY_SLEEP_CMD (default "sleep") exist for the test.
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
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
# 0 = the failure in $log is transient (5xx, 429 rate limit or network), 1 = anything else. A hard 4xx marker (not 429) wins.
is_retryable() {
  grep -Eiq '(status|http|code)[^0-9a-z]{1,3}4(0[0-9]|1[0-9]|2[0-8]|[3-9][0-9])\b|\b4(0[0-9]|1[0-9]|2[0-8]|[3-9][0-9]) (bad request|unauthorized|forbidden|not found)|unauthorized|forbidden|authentication error|invalid (api )?token|invalid request' "$1" && return 1
  grep -Eiq '(status|http|code)[^0-9a-z]{1,3}5[0-9]{2}\b|\b5[0-9]{2} (internal server error|bad gateway|service (temporarily )?unavailable|gateway time-?out)|internal server error|bad gateway|service (temporarily )?unavailable|gateway time-?out|\b429\b|too many requests|rate limit|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|network error|UND_ERR_|other side closed' "$1"
}
attempt=1
max=6   # 1 try + 5 retries
while true; do
  # shellcheck disable=SC2086
  $cmd "$@" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then
    [ -n "$indexnow_env" ] && sleep "${INDEXNOW_DELAY:-20}"  # let the edge serve the new HTML before crawlers are told
    indexnow ping
    exit 0
  fi
  if ! is_retryable "$log"; then
    echo "wrangler deploy failed (exit $rc) with an error that is not a 5xx or a network error; not retrying" >&2
    exit "$rc"
  fi
  if [ "$attempt" -ge "$max" ]; then
    echo "wrangler deploy failed after $attempt attempts (exit $rc)" >&2
    exit "$rc"
  fi
  wait_s=$((pause * (1 << (attempt - 1))))
  # Respect a Retry-After wrangler prints (seconds), never waiting less than the backoff; capped at 15 min.
  ra="$(grep -Eio 'retry-after[^0-9]{1,4}[0-9]+' "$log" | grep -Eo '[0-9]+$' | tail -1)"
  if [ -n "$ra" ]; then
    [ "$ra" -gt 900 ] && ra=900
    [ "$ra" -gt "$wait_s" ] && wait_s="$ra"
  fi
  echo "wrangler deploy failed (exit $rc, 5xx or network), attempt $attempt of $max; retrying in ${wait_s}s" >&2
  ${DEPLOY_SLEEP_CMD:-sleep} "$wait_s"
  attempt=$((attempt + 1))
done
