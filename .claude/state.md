# State (komprimerad 2026-10-21)

Historik: se .claude/state-archive.md, läs bara vid behov.
Aktiv spec: .claude/spec-time-alerts-heroes.md (Fas 0-5 klara, Fas 6 kvar).

## 1. Nu
- Fas 6 (dark mode) KLAR och pushad 2026-10-21 (ägaren godkände). Alla tre städer byggda, vitest 1148 +
  pytest 919 gröna, astro check 0 fel, sitemap/noindex OK (Brookings 109, Moreno 141, Broomfield 79).
  Ägaren kollar mörkt läge på telefon; inga Moreno/Broomfield-skärmbilder gjorda.
- BESLUT Fas 6: --navy ljus (#9bbbe3) i dark, fyllda knappar inverteras av sig själva; nya variabler
  --sign-bg/--on-accent/--paper-tint; sektionsaccent via body --section-accent-l/-d + has-accent;
  tema i localStorage 'bv_theme'. Skärmbildsverktyg: playwright python, channel msedge.
- /today Tonight/Tomorrow-bugg (trasig live sedan Fas 1, alla städer) FIXAD 2026-10-21: skriptet använde
  querySelectorAll(':scope > li') på mallens fragment (matchar inget i Chromium) + villkorligt City Hall-
  <script> fick Astro att tappa bucket-skriptet på Broomfield. Nu lib/today-buckets.ts + test i riktig
  Chromium (hoppas över om ingen finns); tomma buckets dolda, en rad -> /whats-on/ när båda tomma.
- scrape_runs (UA-bytet) KLAR 2026-10-21: schemalagda körningar var >3 h försenade, så ägaren lät mig köra
  workflow_dispatch för alla tre scrape-workflows (09:36Z, via git-credential, ägaren godkände).
  Resultat: 21 körningar, 15 ok/200, 5 skipped, 1 stub (road_conditions), 0 st 403/fel.
  Broomfield traffic (data.cotrip.org, gav 403 med gamla UA) = ok 200. Ingen UA-återställning behövs.
- FLAKY? 2 vitest-tester föll en gång 2026-10-21 (66 s körning, direkt efter en astro build), ej
  identifierade; 5 omkörningar (varav 1 under CPU-last) = 1152/1152 gröna. Om det återkommer: kör
  --reporter=verbose och logga namnen här.
- NÄSTA: Kö 2+ (Kö 1 Fas 6 klar).

## 2. Kö
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
6. Moreno meetings-dubbletter: steg 1 (kodfix) KLAR+pushad 2026-10-21; steg 2 (städskript) och 3 (UNIQUE-index) kvar.
   Plan: .claude/plan-ko6-meetings-dedup.md. Orsak: vanlig scrape 11502 efter tidszonsfixen; "unikt index från
   Phase B" VAR FEL premiss. BESLUT (ägaren): behåll redirect-riktningen för de 11 hanterade grupperna (vänd
   inget); per grupp behåll meetings-raden som hör till canonical live-story oavsett ålder, nollställ meeting_id
   på supersedade stories, radera övriga meetings-rader; oavgjorda 6918217e (story 4008) + c47d15ac (3944/3974):
   äldsta story canonical, nyare får superseded_by_slug+301; content_hash sätts bara om ledig. Kodfix: identity_key
   (ID/EventId/id) i BaseParser+upsert_records, uppdaterar ÄLDSTA raden. OBS städskriptet: skrapningar mellan push
   och städning uppdaterar äldsta raden, så merga raw_data från ALLA rader i gruppen in i behållaren (nyaste vinner).
   Städskript KLART (ej körd): scripts/merge_duplicate_meetings_by_source_id.py (dry-run default, --apply = live-DB,
   en transaktion, backup i backups/). Dry-run fann: de 13 dubblettraderna bär project_updates(6)/candidate_queue(11)/
   checkpoints(10) -> repointas/slängs enligt skriptdoc. NÄSTA: ägarens ja till --apply, sen generate_duplicate_story_
   redirects + push, sen migration UNIQUE-index (steg 3), sen steg 4-rapport (Brookings/Broomfield 0 dubbletter).
7. QA #9 Celebration Park-öppettider (Moreno, info, lägst prio).

8. (Låg prio) Kontrollera i scrape_runs att Brookings eventkällor och Moreno Valleys events/meetings går ok
   med nya User-Agent efter deras nästa körning.

## 3. Gällande beslut (kortform)
- En push per batch, efter fullt batteri; pusha inte utan ägarens ja (undantag: ägaren
  beordrar uttryckligen en push). "Visa X innan push" = stanna och vänta på nytt ja.
- Ingen ny cron; allt tidsrelativt (Today/Tonight, N events today, dagräkning, öppet/stängt)
  räknas i webbläsaren i stadens tidszon; byggtid visas som "Updated <tid>".
- Varningar: slut = ends_at, annars parsat ur texten, annars +24 h; county_alert i kategorin
  'Hazardous Weather Alerts' och gamla county_alert (>24 h) når aldrig varningsytorna.
- Inga datum i config: top_events anger titelmönster ("Hobo Day"), Hobo Day-datumet härleds
  ur kalendern (första lördag efter sista HDC-event).
- Skyltremsan: alltid sport; football inom 7 kalenderdagar > närmaste hemmamatch > nästa.
- Inga foton i fler än en stad (denylist + cross-town-guard i source_category_images.py);
  inga bilder med identifierbar plats (skyltar, butiksnamn, landmärken, vattenstämplar).
- Tvåmånadersregeln gäller bara startsidans "This week". Sektionsheroes byter månadsvis och
  vid säsongs-/högtidsgräns; repriser mellan perioder är OK.
- Heat/dust-widget bara Moreno Valley (flagga hasHeatAdvisory), aldrig nivån "safe".
- Statusfärger via lib/status-tokens.mjs (en källa), WCAG-kontroll fallerar bygget.
- User-Agent: "ViewMediaBot (+https://<stad>view.com/contact)" per stad (scrapers/user_agent.py).
- Källor: följ robots.txt; ingen RSS.aspx på broomfield.org; sluta hämta en blockerad källa;
  publicera bara fakta + egen kort sammanfattning, kreditera källan med länk, hämta högst dagligen.
- Skrivningar mot LIVE-databasen kräver ägarens godkännande (även omkörningar).
- Allt som ska godkännas skrivs i klartext i svaret, inte bara i verktygsutdata.
- Ändras beroenden eller nya testfiler: kör npm ci + testsviten i ren miljö före push.
- Hobo Week-"Special Events" -> campus; SDSU-bucket är update-kolumn (självläker vid scrape).

## 4. Kända luckor
- Bildpooler ~12-16/säsong/stad; vår/sommar saknas helt (se Kö 3). Broomfield events-pool tunn.
- Gränsfallsbilder kvar (ägaren: OK): university-2/3/4, city_hall-2/3/5, "CIVIC CENTER"-skylt.
- Skyltremsans temperatur/prognos och Weekend-modulens Fri/Sat/Sun-siffror är byggräknade.
- CityStatus: vid flera varningar döljs modulen först när den sista löpt ut (antalet kan vara för högt).
- Widgetens scopade CSS (.heat-advisory) ligger kvar i alla byggen (inert; text/markup läcker inte).
- User-Agent-bytet rök-testades mot 8 källvärdar; Akamai/Cloudflare-skyddade källor kan
  reagera -- kolla första schemalagda scrape-körningarna efter push.
- Broomfield stadskalender: alla 4 event-kategorier var tomma 2026-10-21 (säsong); övriga
  ~20 flöden är styrelse-/rådsmöten och ingesteras inte. Inget publiceras förrän events dyker upp.
- Hobo Week-omklassningen syns först efter nästa schemalagda SDSU-scrape (verifiera i DB).
- Pexels API: 200 anrop/timme -- source_category_images.py --apply tar ~125.
- tests/test_feature_flags m.fl. förutsätter hand-synkade configs (JSON <-> site-config.ts).
