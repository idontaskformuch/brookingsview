#!/usr/bin/env bash
# astro build with ONE retry (owner 2026-11-07): a transient DB/network error at build time (e.g. "fetch failed" against
# Neon) must not cost a whole deploy. Waits BUILD_RETRY_PAUSE seconds (default 30), then rebuilds once. A real build
# error (type/syntax/content error, anything not matching the transient markers below) fails at once, no retry.
# Run from site/. BUILD_CMD (default "npx astro build") and BUILD_SLEEP_CMD (default "sleep") exist for the test.
set -u
pause="${BUILD_RETRY_PAUSE:-30}"
cmd="${BUILD_CMD:-npx astro build}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
is_transient() {
  grep -Eiq 'fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|socket hang up|other side closed|UND_ERR_|connection terminated|connection timeout|timeout expired|error connecting to database|NeonDbError|too many connections|\b(502|503|504)\b (bad gateway|service unavailable|gateway time-?out)' "$1"
}
# shellcheck disable=SC2086
$cmd "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] && exit 0
if ! is_transient "$log"; then
  echo "build failed (exit $rc) with an error that is not a transient DB/network error; not retrying" >&2
  exit "$rc"
fi
echo "::warning::build failed (exit $rc) with a transient DB/network error; RETRY 1 of 1 after ${pause}s" >&2
echo "BUILD RETRY: transient error detected (see log above), retrying once in ${pause}s" >&2
${BUILD_SLEEP_CMD:-sleep} "$pause"
$cmd "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
[ "$rc" -ne 0 ] && echo "build failed again on the retry (exit $rc)" >&2
exit "$rc"
