# State (komprimerad 2026-10-21)

Historik: se .claude/state-archive.md, läs bara vid behov.
Aktiv spec: .claude/spec-time-alerts-heroes.md (Fas 0-5 klara, Fas 6 kvar).

## 1. Nu
- VÄNTAR PÅ ÄGAREN (hemma), i denna ordning (Kö 9 Steg 1; 09ea03f committad, EJ pushad):
  1. Ägaren slår på Secret scanning + Push protection (+ Dependabot alerts) i repots Settings -> Advanced Security
     (kontrollerat 2026-10-21: alla fem står "disabled").
  2. Ägaren säger ja -> `wrangler deploy` av cron-dispatcher/ (deploya INTE före token finns).
  3. Ägaren skapar fine-grained token (90 d, bara brookingsview, Actions: Read and write) och kör
     `npx wrangler secret put GITHUB_TOKEN` i cron-dispatcher/. Fyll i utgångsdatum under Gällande beslut.
  4. Manuell dispatch-test. Ta bort schedule:-blocken (scrape.yml, moval-/broomfield-scrape.yml, closure-watch-morning.yml,
     moval-closure-watch-morning.yml) FÖRST när minst en cron-startad scrape gått grönt; visa diffen innan.
  5. ALERT_WEBHOOK är INTE satt (inte bland repots 19 Actions-secrets, inte i lokala .env; kontrollerat 2026-10-21). Vakthunden
     (scrape-liveness-check) larmar därför bara genom att workflow-körningen blir röd; GitHub mejlar då den som senast ändrade
     cron-raden i den filen (ägaren, via commit-e-posten) om Notifications -> Actions är påslaget (github.com/settings/notifications).
     Vill ägaren ha push/Slack/Discord: skapa en inkommande webhook, lägg som Actions-secret ALERT_WEBHOOK (samma secret läses av
     staleness-check, liveness-check och scraper-larmen).
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
- NÄSTA: Kö 9 Steg 1 byggt+committat (09ea03f), väntar på ägarens punkter 1-5 ovan. Därefter Kö 9 Steg 2, Steg 3, sen Kö 2+.

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

9. ACTIONS-KOSTNAD/SCHEMA (utredning 2026-10-21, 30 d 21/9-21/10, 981 körn.; repot förblir PUBLIKT = 0 kr, siffror gäller om privat):
   4 965 fakt.min (privat ≈ $17,8/mån): scrape 2 070 (42 %), push-deploy 1 177 (24 %, alla 3 städer vid varje push, ingen
   concurrency), dagliga/veckovisa 1 566 (32 %), tests+staleness 152. Per stad: Moreno 2 347 (bygge 4 min), Brookings 1 378,
   Broomfield 1 088. Byggena sker på GitHub (Workers Builds avstängt). Nattliga roundups/whats-on-intro bygger+deployar
   ovillkorligen (~350 min slöseri). "Deploya bara vid ändring" sparar bara ~9 % ensamt; paket (2x/dygn scrape + bygg vid
   ändring + roundups + concurrency/stadsfilter) ≈ 3 000 min (~$6). 5 städer ≈ $37 (nu)/$17 (optimerat), 20 ≈ $180/$100.
   GitHub-cron startar 4,5-9,5 h SENT (closure-watch 10:30Z startar 15-20Z; scrape ~4 h sen) -> morgonkörningen är värdelös.
   Källor: jobs/events/SDSU/möten nya nästan dagligen (1x/dygn räcker); ag_markets 1 dag/30; Moreno traffic ändras i 110/114
   körningar (får EJ räknas som ändring); road_conditions + business_licenses 0 ok-körningar; Moreno school_alerts 0 rader/30 d.
   NWS api.weather.gov: CORS *, ingen preflight, UA ej krävd i praktiken, cache 5 s; ingen CSP i repot.
   BESLUT (ägaren): Steg 1 (prio före första snön) Cloudflare Worker + cron triggers -> workflow_dispatch för scrape +
   closure-watch, fin-grained token (bara Actions write, detta repo) som Worker-secret, closure-watch morgon i ALLA tre städer;
   VISA plan+token-scope före bygge. Steg 2: roundups bygger bara vid ny text, concurrency + stadsfilter push-deploy, scrape
   2x/dygn bygg bara vid ändring (traffic räknas ej), stäng road_conditions+business_licenses, verifiera Moreno school_alerts.
   Steg 3: NWS i webbläsaren med samma alerts.ts-filter. En commit per steg, pusha ej utan ja.
   FYND: Broomfield har school_alerts_adams12/_bvsd men INGEN closureWatch-config (hasClosureWatch=false, /closures redirectar).

   STEG 1 (2026-10-21): Broomfield-morgonkörning UTESLUTEN (väg 3): scrape_runs har 0 körningar/0 rader någonsin för
   school_alerts_adams12/_bvsd (båda enabled:false, Adams 12 bot-challenge, BVSD app) -> ta upp igen när en källa finns.
   Byggt (EJ deployat, EJ pushat): cron-dispatcher/ (Worker, crons "0 */6 * * *" + "30 10-13 * * 1-5", lokal-05:30-filter för
   Chicago/LA), scripts/check_scrape_liveness.py + .github/workflows/scrape-liveness-check.yml (GitHubs eget schedule, 18 h,
   alla tre städer, ALERT_WEBHOOK). KVAR: ägaren godkänner wrangler deploy; ägaren skapar token + `wrangler secret put`;
   först DÄREFTER tas schedule:-blocken bort ur scrape.yml, moval-scrape.yml, broomfield-scrape.yml, closure-watch-morning.yml,
   moval-closure-watch-morning.yml (visa diff först). Tills dess kör både GitHub och Worker = dubbla körningar.

## 3. Gällande beslut (kortform)
- Repot förblir publikt tills sajterna drar in pengar, görs då privat (Actions-kostnad vid privat: se Kö 9).
- Cloudflare cron-dispatcher-token (fine-grained PAT, Actions:write, bara detta repo): giltig 90 dagar från skapande.
  UTGÅNGSDATUM: fylls i av ägaren när token skapats (senast 2027-01-19 om den skapas 2026-10-21); lägg en påminnelse 14 d före.
  Utgången token => 401 i Worker-loggen + scrape-liveness-check röd efter 18 h.
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
