# State-arkiv

Historik flyttad ut ur .claude/state.md 2026-10-21 (inget raderat, bara flyttat). Läs bara vid behov.

---

## A. Tidigare state.md, ordagrant (sessionerna 2026-10-16 och 2026-10-21)

2026-10-21 (spec .claude/spec-time-alerts-heroes.md). Fas 1-5 pushade tidigare
  (32b8a1b). PUSHAT i ett svep efter fullt batteri (vitest 1127 UTC+Stockholm,
  pytest 900, astro check 0, 3 byggen, sitemap/noindex x3, heat-läckage x3):
  Hobo Week -> campus (namnregel + datumregel, Hobo Day härleds ur HDC-event),
  låga mobil-heroes + bort Badlands, månadsvis hero-rotation, skyltremsan med
  sport + prioritering (football inom 7 d > närmaste hemmamatch) + klientdagar,
  top_events-marquee (configs/brookings_sd.json features.top_events, mönster ej
  datum, speglas i site-config.ts, kollas av tests/test_top_events_config.py).
  ÖPPET, senare push (ägarens bildbeslut): (a) en bild = en stad; Broomfield egna
  kategoripooler (val klara i scripts/source_category_images.py, EJ applicerade;
  denylist scripts/category_image_denylist.json + cross-town-guard i --apply),
  de 2 Moreno-dubbletterna (school_alerts-4, sports-5) ligger i denylisten.
  (b) PUNKT FÖR SIG, bygg inte nu: VÅR- och SOMMARPOOLER för "This week" +
  sektionshero (alla tre städer) måste finnas före 1 mars 2027, annars faller
  heroes till kategori-reserv och startsidans This week kastar. Verktyg:
  scripts/source_this_week_images.py. Fas 6 (dark mode) väntar på (a).

2026-10-16. merge_raw_data fix + restore built, tested, run, and about
  to be pushed (this commit). Moreno Valley duplicate-row cleanup
  SKIPPED this session -- see NEXT STEP. No full pre-push battery
  (astro check/3-town build/sitemap) run for this change -- owner said
  "gör inget mer" after confirming the push; it's a pure backend/DB
  change (scraper + one-off script), no site/build code touched.

DONE, pushed with this commit:
  - db.upsert_records() new opt-in merge_raw_data=True param: raw_data
    merges (jsonb ||) instead of blind-replacing on rescrape. Default
    False, zero change for ~10 other existing callers.
  - LegistarParser/AgendaLinkParser/EscribeParser set merge_raw_data=True
    (base_parser.py new attribute, runner.py reads it generically).
  - Tests added (test_db_upsert_dedup.py, merge SQL shape + regression
    safety) and test_runner_doc_errors.py's fake db stub fixed (missing
    kwarg). Full pytest green (878 passed, 8 skipped) before this push.
  - scripts/restore_legistar_agenda_from_snapshot.py: dry-run shown,
    owner approved, RAN for real against production. Restored 9
    Brookings meetings' agenda_items/agenda_text from their last known-
    good source_snapshots entry (merge, not overwrite). Verified live in
    DB (all 9 now have the expected item counts: 1314=6, 2428=6,
    10737=14, 10811=10, 10969=14, 10971=4, 10973=6, 11006=6, 11009=6).
    13 other candidates reported, correctly left untouched (3 predate
    the snapshot archive, 10 genuinely never had items).

SKIPPED THIS SESSION, owner's explicit call ("Skippa dubbletterna"):
  Moreno Valley duplicate meetings rows (2193/13786, 2194/13788 pairs --
  same real eSCRIBE meeting, duplicate row under a different content_hash,
  most likely from an un-tracked one-off backfill script around the Oct 1
  "mass insert" that bypassed dedup_check_columns -- see prior investigation
  for full reasoning). Confirmed safe to delete 13786+13788 (keep the
  older 2193+2194): zero references from stories, meeting_decisions,
  project_updates, project_match_review_queue, project_new_candidate_queue,
  or project_updates_checkpoints. Attempting to write/run the DELETE was
  blocked by Claude Code's own safety classifier (flagged as a dangerous
  action, generic reason given); did not attempt a workaround per that
  denial's own instructions -- handed the decision back to the owner
  instead of retrying through another tool/script.

NEXT STEP: Moreno Valley duplicate-row cleanup is still open. Owner can
  either run this directly against the DB, or add a permission rule
  that lets a scripted DELETE through and ask for a retry:
    DELETE FROM meetings WHERE id = 13786;  -- duplicate of 2193 (kept)
    DELETE FROM meetings WHERE id = 13788;  -- duplicate of 2194 (kept)
  No other table references either row (confirmed above) -- safe
  whenever the owner wants to act on it. Not scheduled/blocking anything
  else.

PRE-EXISTING OPEN ITEMS, unchanged: QA finding #9 (Celebration Park
  hours, Moreno Valley, info-only, lowest priority) -- not scheduled.

---

## B. Spec-filens Fas 0-5, ordagrant (kortade till en rad var i spec-time-alerts-heroes.md)

## Fas 0: Utred (belagda fynd, anta inget)
1. Var kommer gröna rutan ifrån? (Troligen heat/dust-advisory från Workplace Watch Phase 2, bara MV.) Komponent, hur den hamnar på /today, varför gating inte stoppar Brookings.
2. Varför /today 3 h gammal? Körs timbygget + deployar för alla tre? Senaste lyckade deploy per Cloudflare-projekt mot schema.
3. Tidsfält på sparade varningar (effective, onset, expires, ends, sent): vad lagras, vad filtrerar listningen på. Ta fram fog (10/12) och freeze i DB, förklara varför de visas.
4. Inventera tidsrelativ text vid build ("today","tonight","open/closed","in N days","N events today","as of"): build- eller browser-beräknat, vilken tidszon.
5. Emojier som ikoner i src/ (📅 m.fl.).
6. Hero-val per sektion: var /events-bilden sätts, andra fasta sektionsbilder vs rotationen för "This week".

## Fas 1: Varningar och tidskänsliga statusar
Hellre utelämna än visa fel.
- Visa varning bara om slut i framtiden: ends först, annars expires. Saknas båda: dölj 12 h efter sent.
- En delad funktion activeAlerts(town, now) för statusremsa, Right Now, /today, Closure Watch, CityStatus.
- data-ends-attribut; dölj i browser när tiden passerat.
- Visa sluttid i stadens lokala tid med veckodag+datum ("until 9 AM Sat Oct 24").
- Öppet/stängt räknas i browser från strukturerade öppettider i stadens tz (America/Chicago, Los_Angeles, Denver). Utan JS: bara öppettider, aldrig open/closed.
- "N events today", "in N days", Today/Tonight/This weekend: browser-beräknat, eller dolt när bygget >2 h gammalt.
- Passerade evenemang aldrig under Today/Tonight.
- "as of" = riktig byggtid; >2 h gammal: diskret markering.
- Om Fas 0 visar att timbygget inte körs: åtgärda, högljutt fel vid misslyckad deploy.

## Fas 2: Gating och status-styling
- Heat/dust-advisory: flagga i per-stad features-config, default av, på bara för MV. Rendera bara vid faktisk varningsnivå ("safe" visas inte). Läckagetest: Brookings/Broomfield-bygget får inte innehålla "loading-dock" eller komponenten.
- Statusfärger via gemensamma CSS-variabler (--status-ok/-warn/-alert, separata text/bakgrund). Utöka WCAG-kontrollen (Local Accent Identity) till dem; bygget fallerar under 4.5:1. Ingen mintgrön-på-mintgrön; status = liten färgad punkt/kant, text i vanlig färg. "--" -> "–". Variablerna ska kunna få mörka värden under prefers-color-scheme: dark (själva dark theme ingår inte).

## Fas 3: Emojin och datumbrickor
- Ta bort 📅 överallt; ersätt med CSS-datumbricka ("OCT / 20", stadens tz) eller ingen ikon. Samma för andra ikon-emojier. Test som fallerar om 📅 eller 🗓 finns i src/ (sajtkoden).

## Fas 4: Sektions-heroes via säsongsrotation
- Delad resolver getSectionHero(town, section, date) på befintlig rotationspool/datumintervall. Inga hårdkodade bilder.
- Startsidans regler: ny bild minst varje vecka, ingen repris inom 2 mån, säsong/högtider, mix stad/byggnader/natur.
- Deterministiskt per stad+sektion+ISO-vecka; sektioner delar inte bild med startsidan eller varandra.
- Valfri reservbild per sektion, bara om poolen tom; saknas båda: bygget fallerar.
- Inga bilder med annan identifierbar plats (skyltar, butiksnamn, landmärken). Ta bort paradbilden från /events, kontrollera övriga fasta.
- Behåll fotografattribuering.
- Minst /events, /today, /city-hall, /closures, Farm Report + alla Fas 0 hittar.

## Fas 5: Textpolish
- "organiser's" -> "organizer's" i /events-intro. Sök övriga brittiska stavningar (-ise, -our, -tre) i statisk text; AI-genererat orört. Konsekventa kategorietiketter på evenemang.


---

## C. Utfört 2026-10-21

- Moreno Valley dubblettmöten: meetings 13786 och 13788 raderade i produktion på ägarens uttryckliga godkännande (SQL .claude/moreno-duplicate-meetings.sql, steg 1-4; guard: keeper 2193/2194 med samma eSCRIBE-guid och datum; 6 FK-tabeller 0 rader; RETURNING exakt 13786+13788; efterkontroll: bara 2193 och 2194 kvar).

## Flyttat från Kö i state.md 2026-10-21 (backlog.md har enradsversioner)
1. (Fas 6 klar.)
2. Compass-källan för Broomfield (compass.broomfield.org) -- VÄNTAR PÅ SVAR FRÅN BIBLIOTEKET.
   Biblioteket mejlades 2026-10-20; påminnelse tidigast 2026-11-03. Rör inte källan:
   robots.txt stänger oss ute (`User-agent: *` Disallow: / utom statiska filer; bara namngivna
   sök-/social-/annonsbotar släpps in). Löften i mejlet som MÅSTE hållas när det byggs:
   - bara publika, biblioteksarrangerade program; inga auditorie-/rumsuthyrningar alls,
     inte heller namngivna (t.ex. symfoniorkestern);
   - titel, datum, tid, plats + kort sammanfattning med egna ord (genom omformuleringskontrollen);
   - biblioteket krediteras som källa på varje listning, plus länk till Compass
     (lib/source-credit.ts har redan host-etiketten);
   - hämtning högst några gånger per dag;
   - påminnelse tidigast 2026-11-03.
   Plattform: Drupal 11 / LibraryMarket "Library Calendar" (lc_calendar). Flödestyp ej bekräftad
   (kräver tillåtelse). Discover Vail ska INTE kopplas in (annan ort).
3. Vår- och sommarpooler före 1 mars 2027: "This week" + sektionshero, alla tre städer.
   Annars faller heroes till kategori-reserv och startsidans This week kastar (60-dagarsregeln).
   Verktyg: scripts/source_this_week_images.py (har ingen denylist än -- lägg till som i
   scripts/source_category_images.py). Bygg inte förrän ägaren säger till.
4. Övriga ikon-emojier (bara 📅 är borta): StoryCard CHIP (🏛️🚗🏠💼🏈🎒⚠️🏭🎓), widgetar
   (🐴📊🏔️🐇), university.astro (🎵🎭🎉🏕️ + sport), 📍 (s/[slug], city-hall/projects), 🏟️ (events),
   📦 (weather).
5. Broomfield facility name_aliases (data/facilities/broomfield_co.json): VÄNTA tills det första riktiga
   eventet har kommit in från stadskalenderns flöde (riktiga LOCATION-strängar), SEEDA INGET NU.
   Sen: lägg alias efter de verkliga strängarna och kör seed_facilities -- en LIVE-DB-skrivning, fråga först.
6. (Kö 6 KLAR 2026-10-21.) Moreno meetings-dubbletter: kodfix (identity_key, 69996a3), städning (12 grupper, 13 meetings
   + 6 dubblett-project_updates raderade, 4008/3974 -> 301, 9cce4ee) och migration 060 (3 UNIQUE-index: ID/EventId/id per
   town_id, verifierade 0 dubbletter först) KLARA och live. Premissen "unikt index från Phase B" var fel (bara hash-index).
   BESLUT: redirect-riktningen behölls (inget vändes); keeper = meetings-raden för canonical live-story; raw_data-merge
   keeper-först (tom/false skriver aldrig över riktigt värde). backups/ nu gitignorad (repot är PUBLIKT); de 6 äldre
   incheckade backuperna granskade: bara offentlig data (stadens kontakt-mejl/telefon ur agendatext, AI-essäer, titlar);
   ingen IP/kommentar-data. Nya backupen backups/merge_duplicate_meetings_*.json ligger kvar lokalt (bevara).
7. QA #9 Celebration Park-öppettider (Moreno, info, lägst prio).

8. (Låg prio) Kontrollera i scrape_runs att Brookings eventkällor och Moreno Valleys events/meetings går ok
   med nya User-Agent efter deras nästa körning.

10. QA Q5 (efter Q2-Q4; BYGG INGET NU, ägarens beslut 2026-10-21): Auto-fix-agent via Claude Code GitHub Actions
   (anthropics/claude-code-action). Nivå 1 först: hårt QA-fel -> issue -> agenten skriver fix som PR -> CI + QA körs på PR ->
   ägaren godkänner från telefonen. Nivå 2 (senare, efter några veckor med bra träffsäkerhet): auto-merge för smal vitlista
   (stavning i statisk text, denylista bild, utgången waiver) bara om allt är grönt. Nivå 3, aldrig automatiskt: live-DB-skrivningar,
   nya beroenden, workflows/hemligheter, innehåll och design. Kostnad: API per fix + Actions-minuter (gratis så länge repot är publikt).

