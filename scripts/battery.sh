#!/usr/bin/env bash
# Batteriet före fas-commit (CLAUDE.md regel 3). Det enda sättet att köra det:
#   bash scripts/battery.sh [loggkatalog]     (standard: scratch_tmp/battery)
# Kör allt även när ett steg faller; exit 0 bara om alla steg är gröna.
#   - DIST_SNAPSHOT=<mapp utanför repot> kopierar dist till <mapp>/<stad> efter
#     varje grönt bygge (underlag för scripts/dist_compare.mjs).
#   - astro check körs med SITE_CITY satt (CHECK_CITY, standard brookings_sd).
#   - Ett bygge som faller på nätverksfel mot databasen ("fetch failed" m.fl.)
#     körs om EN gång och omkörningen loggas. Andra byggfel körs aldrig om.
#   - Känd flake: section-nav-ui.test.ts afterAll (browser.close) timeout medan
#     alla tester är gröna. Skrivs ut som känd flake och ger inte rött. Varje
#     annat vitest-fel (eller ett fallerat test i samma fil) ger rött.
set -o pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(cd "$ROOT" && mkdir -p "${1:-scratch_tmp/battery}" && cd "${1:-scratch_tmp/battery}" && pwd)"
CHECK_CITY="${CHECK_CITY:-brookings_sd}"
TOWNS="brookings_sd moreno_valley_ca broomfield_co glasgow"
NET_ERR='fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Connection terminated unexpectedly'
failed=()

step() {  # step <namn> <exit>
  echo "$1 $2"
  [ "$2" -eq 0 ] || failed+=("$1")
}

cd "$ROOT" || exit 2
echo "battery start $(date '+%F %T') logs=$LOG"

.venv/Scripts/python.exe -m pytest tests/ -q > "$LOG/pytest.log" 2>&1
step pytest $?
tail -2 "$LOG/pytest.log"

cd "$ROOT/site" || exit 2
npx vitest run --reporter=default --reporter=json --outputFile.json="$LOG/vitest.json" > "$LOG/vitest.log" 2>&1
rc=$?
tail -5 "$LOG/vitest.log"
if [ $rc -ne 0 ] && node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const bad = r.testResults.filter((f) => f.status !== "passed");
  const flake = (f) => /section-nav-ui\.test\.ts$/.test(f.name.replace(/\\/g, "/"))
    && /Hook timed out/.test(f.message || "")
    && f.assertionResults.every((a) => a.status === "passed");
  process.exit(r.numFailedTests === 0 && bad.length === 1 && flake(bad[0]) ? 0 : 1);
' "$LOG/vitest.json"; then
  echo "vitest: KÄND FLAKE section-nav-ui.test.ts (hook-timeout, alla tester gröna) -- räknas som grönt"
  rc=0
fi
step vitest $rc

SITE_CITY=$CHECK_CITY npx astro check > "$LOG/check.log" 2>&1
step "check($CHECK_CITY)" $?
tail -4 "$LOG/check.log"

for t in $TOWNS; do
  SITE_CITY=$t npm run build > "$LOG/build-$t.log" 2>&1
  rc=$?
  if [ $rc -ne 0 ] && grep -Eq "$NET_ERR" "$LOG/build-$t.log"; then
    cp "$LOG/build-$t.log" "$LOG/build-$t.try1.log"
    echo "build $t: OMKÖRNING (nätverksfel mot databasen: $(grep -Eo "$NET_ERR" "$LOG/build-$t.log" | head -1)); första loggen i build-$t.try1.log"
    SITE_CITY=$t npm run build > "$LOG/build-$t.log" 2>&1
    rc=$?
  fi
  step "build $t" $rc
  [ $rc -eq 0 ] || { echo "  hoppar över kontrollerna för $t (bygget föll)"; continue; }
  if [ -n "$DIST_SNAPSHOT" ]; then  # valfritt: spara dist per stad (dist-jämförelse)
    rm -rf "$DIST_SNAPSHOT/$t" && mkdir -p "$DIST_SNAPSHOT" && cp -r dist "$DIST_SNAPSHOT/$t"
    step "snapshot $t" $?
  fi

  node ../scripts/verify_sitemap_noindex_disjoint.mjs dist 2>&1 | tail -2; step "disjoint $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_no_empty_messages.mjs dist 2>&1 | tail -1; step "empty-messages $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_content_first.mjs dist 2>&1 | tail -1; step "content-first $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_no_internal_notes.mjs dist 2>&1 | tail -5; step "internal-notes $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_town_games.mjs dist "$t"; step "town-games $t" $?
  node ../scripts/verify_local_images.mjs dist "$t"; step "local-images $t" $?
  node ../scripts/verify_nav_links.mjs dist "$t"; step "nav-links $t" $?
  node ../scripts/verify_internal_links.mjs dist > "$LOG/internal-links-$t.log" 2>&1; step "internal-links $t" $?
  tail -1 "$LOG/internal-links-$t.log"
  node ../scripts/verify_today_page.mjs dist "$t"; step "today-page $t" $?
  node ../scripts/verify_hours_schema_fresh.mjs dist; step "hours-schema $t" $?
  node ../scripts/verify_this_week_days.mjs dist; step "this-week-days $t" $?
  node ../scripts/verify_description_days.mjs dist 2>&1 | tail -12; step "description-days $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_description_venue.mjs dist 2>&1 | tail -12; step "description-venue $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_election_pages.mjs dist; step "election-pages $t" $?
  node ../scripts/report_meta_descriptions.mjs dist "../.claude/review/meta-descriptions/$t.tsv" 2>&1 | tail -12; step "meta $t" "${PIPESTATUS[0]}"
done

echo "battery slut $(date '+%F %T')"
if [ ${#failed[@]} -eq 0 ]; then echo "BATTERI GRÖNT"; exit 0; fi
echo "BATTERI RÖTT: ${failed[*]}"
exit 1
