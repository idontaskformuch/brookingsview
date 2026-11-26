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
# Lokala byggen skriver aldrig till live-DB (Fas 0.5, 2026-11-18): flaggan sätts bara i CI:s produktionsbyggen.
unset IMAGE_HISTORY_WRITE
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# QA build.lowercase-drive (ägaren 2026-11-25): vägra köra från "c:\..." (liten enhetsbokstav). Därifrån blir bygget grönt utan
# komponent-CSS på någon sida, och vitest laddar två instanser av @vitest/runner. Kontrollen gäller katalogen batteriet startas i.
node "$ROOT/site/scripts/require-upper-drive.mjs" || { echo "battery: AVBRUTET, inget steg kört (liten enhetsbokstav)" >&2; exit 2; }
ROOT="$(cd "$ROOT" && { pwd -W 2>/dev/null || pwd; })"

# ---- Lås och processträd (QA build.battery-lock, ägaren 2026-11-25) ----
# Ett batteri åt gången: låsfilen (BATTERY_LOCK, standard scratch_tmp/battery.lock) har övervakarens och kroppens PID på första
# raden. Lever någon av dem vägrar ett nytt batteri (exit 3); ett lås från döda processer tas bort med ett meddelande.
# Stegen körs i en bakgrundskropp medan den här processen (övervakaren) väntar: bash kör en trap först när förgrundskommandot
# är klart, så bara en väntande övervakare kan avbryta mitt i ett bygge. Vid INT/TERM/HUP, eller när den som startade batteriet
# inte längre finns (2026-11-25: ett stoppat batteri levde vidare som föräldralöst och byggde i samma dist som nästa), dödas hela
# kroppens processträd: varje bash-process och, på Windows, varje Windows-processträd under dem (taskkill /T; node-barn syns inte
# för bash). BATTERY_BODY ersätter stegen med ett eget kommando (bara för tests/test_battery_lock.py).
LOCK="${BATTERY_LOCK:-$ROOT/scratch_tmp/battery.lock}"
BODY_PID=""

lock_acquire() {
  mkdir -p "$(dirname "$LOCK")" || exit 3
  local attempt held p alive
  for attempt in 1 2; do
    if ( set -o noclobber; printf '%s\n' "$$" > "$LOCK" ) 2>/dev/null; then return 0; fi
    held=(); read -r -a held < "$LOCK" 2>/dev/null
    alive=""
    for p in "${held[@]}"; do [[ $p =~ ^[0-9]+$ ]] && kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    if [ -n "$alive" ]; then
      echo "battery: VÄGRAR, ett annat batteri kör redan (pid$alive; låsfil $LOCK). Vänta tills det är klart eller avbryt det; inget steg kört." >&2
      exit 3
    fi
    echo "battery: gammalt lås från en död process (${held[*]:-tom fil}) borttaget: $LOCK" >&2
    rm -f "$LOCK"
  done
  echo "battery: kunde inte ta låset $LOCK" >&2
  exit 3
}

lock_release() {  # bara vårt eget lås
  local first=""
  [ -f "$LOCK" ] || return 0
  read -r first _ < "$LOCK"
  [ "$first" = "$$" ] && rm -f "$LOCK"
}

descendants() {  # alla bash-kända efterkommande till $1 (ps -ef: PID i kolumn 2, PPID i kolumn 3)
  local table queue=("$1") out=() p c
  table="$(ps -ef 2>/dev/null | awk 'NR > 1 { print $2, $3 }')"
  while [ ${#queue[@]} -gt 0 ]; do
    p="${queue[0]}"; queue=("${queue[@]:1}")
    for c in $(awk -v p="$p" '$2 == p { print $1 }' <<< "$table"); do out+=("$c"); queue+=("$c"); done
  done
  echo "${out[@]}"
}

kill_tree() {
  local root="$1" p w all
  all="$root $(descendants "$root")"
  for p in $all; do kill -STOP "$p" 2>/dev/null; done  # inget nytt barn hinner startas medan trädet rivs
  if command -v taskkill > /dev/null 2>&1; then
    for p in $all; do
      w="$(cat "/proc/$p/winpid" 2>/dev/null)" && [ -n "$w" ] && taskkill //F //T //PID "$w" > /dev/null 2>&1
    done
  fi
  for p in $all; do kill -KILL "$p" 2>/dev/null; done
}

battery_abort() {  # battery_abort <orsak> <exit>
  trap - INT TERM HUP
  echo "battery: AVBRUTET ($1) -- dödar hela processträdet" >&2
  [ -n "$BODY_PID" ] && kill_tree "$BODY_PID"
  lock_release
  exit "$2"
}

lock_acquire
trap lock_release EXIT
trap 'battery_abort "signal INT" 130' INT
trap 'battery_abort "signal TERM" 143' TERM
trap 'battery_abort "signal HUP" 129' HUP
CALLER="$PPID"
# Lever startaren? kill -0 räcker inte på Linux: en startare som dödats (kill -KILL) blir en zombie tills ITS förälder skördar
# den, och kill -0 lyckas mot en zombie (tests-workflow rött sedan 0220c133). Tillstånd Z i /proc/<pid>/stat = borta. Saknas
# /proc-filen (inte Linux/MSYS) gäller kill -0 ensamt.
caller_alive() {
  kill -0 "$CALLER" 2>/dev/null || return 1
  local st
  st="$(cat "/proc/$CALLER/stat" 2>/dev/null)" || return 0
  st="${st##*) }"
  [ "${st%% *}" != "Z" ]
}
WATCH_CALLER=0
[ "$CALLER" -gt 1 ] 2>/dev/null && kill -0 "$CALLER" 2>/dev/null && WATCH_CALLER=1

LOG="$(cd "$ROOT" && mkdir -p "${1:-scratch_tmp/battery}" && cd "${1:-scratch_tmp/battery}" && pwd)"
CHECK_CITY="${CHECK_CITY:-brookings_sd}"
TOWNS="brookings_sd moreno_valley_ca broomfield_co glasgow"
NET_ERR='fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Connection terminated unexpectedly'
failed=()

step() {  # step <namn> <exit>
  echo "$1 $2"
  [ "$2" -eq 0 ] || failed+=("$1")
}

# Kroppen: alla steg. Körs i bakgrunden; övervakaren längst ner väntar på den (se "Lås och processträd" ovan).
battery_body() {
cd "$ROOT" || exit 2
echo "battery start $(date '+%F %T') logs=$LOG"
# Gamla omkörningsloggar från en tidigare körning tas bort, så build-<stad>.try1.log bara finns när DENNA körning körde om (ägaren 18 nov).
rm -f "$LOG"/build-*.try1.log

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

node ../scripts/verify_astro_template_comments.mjs > "$LOG/template-comments.log" 2>&1
step template-comments $?
tail -3 "$LOG/template-comments.log"

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
  node ../scripts/verify_page_css.mjs dist 2>&1 | tail -3; step "page-css $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_no_internal_notes.mjs dist 2>&1 | tail -5; step "internal-notes $t" "${PIPESTATUS[0]}"
  node ../scripts/verify_town_games.mjs dist "$t"; step "town-games $t" $?
  # Same check as every deploy workflow (2026-11-20: glasgow-deploy failed 19-20 Nov on /how-do-i/, which no local step caught).
  node ../scripts/verify_stub_redirects.mjs dist "$t"; step "stub-redirects $t" $?
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
}

# Övervakaren: startar kroppen, skriver båda PID:erna i låset och väntar i korta steg så att en signal eller en försvunnen
# startare hanteras inom en sekund.
if [ -n "$BATTERY_BODY" ]; then
  bash -c "$BATTERY_BODY" &
else
  battery_body &
fi
BODY_PID=$!
printf '%s %s\nstarted %s log %s\n' "$$" "$BODY_PID" "$(date '+%F %T')" "$LOG" > "$LOCK"
while [ -n "$(jobs -rp)" ]; do
  if [ "$WATCH_CALLER" -eq 1 ] && ! caller_alive; then
    battery_abort "den som startade batteriet (pid $CALLER) finns inte längre" 2
  fi
  sleep 1
done
wait "$BODY_PID"
exit $?
