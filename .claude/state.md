# State (komprimerad 2026-10-21)

Historik: se .claude/state-archive.md, läs bara vid behov.
Aktiv spec: .claude/spec-time-alerts-heroes.md (Fas 0-5 klara, Fas 6 kvar).

## 1. Nu
- NÄSTA (ägaren 2026-10-21, går före Kö 9 Steg 2, Glasgow och Q2): VAL FAS 2, deadline 2 nov. Beslut: Kö 4 + .claude/election-2a-inventory.md.
  Broomfield via Clarity, SD via XLSX, Moreno bara länk (ROV-mejl SKICKAT 2026-10-21, väntar på svar), Worker-JSON utan rebuilds, torrtest mot junivalen.
  Commit lokalt per steg, pusha ej utan ja.
  FYND Broomfield/Clarity 2026-10-21: data ligger på results.enr.clarityelections.com/CO/126592/<ver>/ (current_ver.txt på EVENT-nivå /CO/126592/, ej under
  web.345435 -> 404; inventory-filens sökväg var fel). Flödet är STATEWIDE: 197 contests (Federal/State/State House/State Senate), bara statsvida summor;
  Broomfield syns bara som turnout + precincts (2/2), INGA Broomfield-röster per contest, INGA lokala val.
  ÄGARBESLUT: B (undersök Broomfield-källa, deadline ons 28 okt, annars A = statsvida totaler + turnout, lokala val länkas) + bygg SD-adaptern parallellt.
  B-RESULTAT hittills: (1) results.enr.clarityelections.com/CO/Broomfield/ finns men elections.json = [] (inga val); (2) sos.state.co.us/.../ENR/files/
  Broomfield.pdf = 1 sida "No data available."; broomfield.org Election-Information/Important-Dates länkar inga resultat (robots: inget som hindrar).
  Hittills INGET automatiskt hämtbart -> lutar mot A. Kvar före 28 okt: kolla om elections.json fylls vid valet, ev. fråga Broomfield elections.
- Kö 9 Steg 1 (väntar bara på natten): 09ea03f ÄR pushad (ingår i origin/main, kontrollerat 2026-10-21).
  VAL FAS 2 STEG A KLAR (lokal commit): election-results/ (eget npm-paket, vitest 14 gröna, tsc 0): src/types.ts, src/adapters/sd-xlsx.ts (fflate +
  fast-xml-parser, removeNSPrefix -- SD-filen använder x:-prefix), src/validate.ts (spec 2c: tom, saknad contest, minskning, ändrad kandidatmängd, ej heltal;
  pct-kontroll utelämnad: SD ger ingen pct), fixtur test/fixtures/sd-brookings-2026-06-primary.xlsx (juni, eid 773). Contest-id = siffrorna efter 3-bokstavs
  partykod i bladnamnet. Ej gjort: hämtning (postback + __VIEWSTATE), Neon-schema/migration, Worker-JSON, sida, cron. NÄSTA: Steg B = fetch-lager SD +
  migration 061 (skrivs, körs EJ mot live utan ja) + Worker-endpoint.
  STEG B-D KLARA (lokala commits, vitest 28 gröna, tsc 0): migration 061_election_results.sql SKRIVEN, EJ körd mot live (visas för ägaren först); src/fetch/sd.ts
  (GET ResultsExport.aspx utan eid = pågående val, vägrar om sidans hidElectionDate != förväntat; POST county-target); src/adapters/clarity.ts +
  src/fetch/clarity.ts (statsvida juni-fixturen, current_ver på event-nivå, bara hämta data när version ändrats) + inspectCountyElections: bevakar
  CO/Broomfield/elections.json, 'ready' bara om en post nämner datumet + /CO/Broomfield/<id> (postformen aldrig observerad -> syntetiska testposter, annars
  'needs-review', gissar aldrig). BESLUT: Broomfield-bas = A (statsvida totaler + turnout, lokala val länkas); county-feed tar över vid 'ready'.
  Mejl till Broomfields valkontor skrivet i chatten (ägaren skickar). Kvar: Worker (cron + JSON-endpoint utan rebuild) + Neon-skrivning (kräver 061 godkänd),
  sidan /election-results, torrtest mot juni, indexNow, cityStatus-rad.
  MIGRATION 061 KÖRD mot live 2026-10-21 (ägaren godkände): 4 tabeller (9/6/13/5 kolumner), 0 rader, index finns, verifierat i ny anslutning.
  WORKER KLAR (lokal commit, EJ deployad): election-results/src/{phase,towns,sources,pipeline,store,api,worker}.ts + wrangler.jsonc (cron */10, ingen route satt).
  BESLUT: fetch startar 19:00 lokalt (SD/CO stänger 19:00; spec sa 20:00), 'after' = 07:00+19:00 lokalt, fetchUntil 2026-11-30 = ANTAGANDE (certifieringsdatum ej belagt);
  scope för valideringen = föregående giltiga snapshots contest-id (november-id:n okända); all-noll-svar blockeras (regel 5); källfel sparar inget; Neon-skrivning
  = ETT CTE-statement; JSON-endpoint GET /api/election-results?town=<id> läser senaste VALID snapshot direkt ur Neon (ingen rebuild). Torrtest (test/dry-run.test.ts) mot
  juni: 35 tester gröna. OTESTAT: store.ts SQL mot riktig Postgres (kräver rolled-back testskrivning mot live -> fråga ägaren), deploy kräver secret DATABASE_URL + route per sajt.
  SIDAN KLAR (b53ec46, lokal): /election-results (site/src/pages/election-results.astro) renderas i webbläsaren från /api/election-results?town=<id> (poll 60 s, textContent
  bara, källordning, ingen "winner"), fallback-text + officiell länk i HTML; config/election.ts `results` per stad (Brookings+Broomfield live:true, Moreno live:false = bara länk
  + CA-notis källa sos.ca.gov); page-meta 'election-results'; sitemap/noindex-gating som /vote; CityStatus-raden byts i webbläsaren till "Results: unofficial · see results" kl 20:00
  lokal valdag (swapAt, ingen rebuild) och bygger in resultatraden t.o.m. 27 dagar efter. /vote länkar till resultatsidan. IndexNow: först vid push (EJ pingat).
  BATTERI 2026-10-21: election-results vitest 36 gröna + tsc 0; site vitest 1251 gröna (+section-nav-ui 33/33 gröna med --testTimeout=90000; bara afterAll-hook timeout kvar);
  pytest 942 gröna; astro check 0 fel; bygge x3 OK, sitemap/noindex-disjoint OK (80/144/110 = Broomfield/Moreno/Brookings), ingen stadsläcka i resultatsidans HTML (Brookings kontrollerat utan scripts).
  MILJÖPROBLEM: ströprocesser `astro dev --port 4400/4401/4402` (PID 13072, 10592, 11348, 27588; 40 000-54 000 CPU-sekunder) håller CPU på 100 % och ger Chromium-timeouts i
  section-nav-ui (den "flaky" testen). Ej dödade (inte startade i denna session) -- ägaren avgör.
  2026-10-22 (ägaren beordrade deploy+push): strö-astro-dev dödade (4 st); SQL-test: Neon-gren ej möjlig (ingen API-nyckel) -> samma frågor (fångade ur store.ts) körda i transaktion mot live
  med ROLLBACK: 11 contests, 31 resultatrader, turnout, blockerad snapshot med problems[], bytea-roundtrip, pct 68.7; alla fyra tabeller tomma efteråt. ARKITEKTUR: GET /api/election-results
  ligger nu i sajternas worker (site/server/election-results.ts, town från HOSTNAME, ?town= ignoreras, read-only, Cache 30 s); valets Worker viewmedia-election-results är cron-only (*/10),
  DEPLOYAD (version d00fe4f8), secret DATABASE_URL satt via stdin (aldrig visat), första cron 03:00 UTC = Ok, alla tre 'skipped' (före valet). Fullt batteri: site vitest 1257, election-results 36,
  pytest 942, astro check 0, bygge x3 OK, disjoint 80/144/110.
  PUSHAD 2026-10-22 (1479c1f + fix 9b507f5): första CI-deploy föll (site-bundlen importerade store.ts -> neon ej löst ur election-results/) -> read.ts utan beroenden; section-nav-ui
  föll på CI även vid e126a24 (10 s hook / 5 s test på kall runner) -> hook 90 s, testTimeout 60 s. LIVE: /election-results/ 200 + /api/election-results 200 (available:false, phase before)
  på alla tre domäner; IndexNow /election-results pingat (200 x3). Valets Worker kör cron (03:00 UTC Ok, 'skipped' x3).
  KVAR FÖRE VALET: (1) deploy av Worker: secret DATABASE_URL + route <sajt>/api/election-results* per zon (annars visar sidan "could not be loaded"); (2) ROLLED-BACK testskrivning av
  store.ts-SQL mot live (ej gjord, kräver ägarens ja); (3) Broomfield: mejl till valkontoret SKICKAT 2026-10-21, väntar på svar; kolla även elections.json före ons 28 okt, annars A; (4) ROV-mejl SKICKAT 2026-10-21, väntar på svar (tills dess bara länk för Moreno); (5) fetchUntil 2026-11-30 = antagande;
  (6) första riktiga snapshot granskas manuellt mot källan innan länk delas; (7) push + IndexNow (/election-results på alla tre) när ägaren säger ja.
  Security (API 2026-10-21): Secret scanning + Push protection = ENABLED, Dependabot alerts = enabled; dependabot_security_updates,
  non_provider_patterns, validity_checks = disabled (ej begärda).
  Cron-dispatcher deployad+verifierad (version 33925058 + secret 97cc8bae, GITHUB_TOKEN utgår 2027-10-21). Workerns egen token OTESTAD
  tills första cron (00:00Z). Ta bort schedule:-blocken (scrape.yml, moval-/broomfield-scrape.yml, closure-watch-morning.yml,
  moval-closure-watch-morning.yml) FÖRST när en cron-startad (event=workflow_dispatch) scrape gått grönt; visa diffen innan.
  Vakthunden larmar via GitHub-issues sedan Q0 (ALERT_WEBHOOK används ej).
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
- FLAKY section-nav-ui (CI): föll på CI vid TVÅ pushar (e126a24 och 1479c1f; 10 s hook-timeout, sedan 5 s testtimeout på de första sidöppningarna i riktig Chromium). Lokalt gröna när CPU är fri;
  lokalt föll den också under CPU-last (strö-astro-dev, parallella byggen). Timeouterna höjdes (hook 90 s, test 60 s, 9b507f5/45f8ae7) -- det är en MASKERING av långsamhet, inte en förklaring.
  Loggad i Q4-listan (Kö 6) för riktig orsaksutredning: mät hur lång tid beforeAll/första page.goto faktiskt tar på CI, se om AstroContainer-rendering av 3 städer eller Chromium-start dominerar,
  och om testet bör splittras eller dela en browser. Om den fallerar IGEN trots 60-90 s = verkligt fel (hängning), inte timing: undersök, höj inte mer.
- FLAKY (återkom 2026-10-21 18:18, 1 test föll direkt efter astro build; 3 omkörningar 1199/1199 gröna, namn ej fångat; misstänkt Chromium-test under last: kör --reporter=verbose om igen) -- tidigare: 2 vitest-tester föll en gång 2026-10-21 (66 s körning, direkt efter en astro build), ej
  identifierade; 5 omkörningar (varav 1 under CPU-last) = 1152/1152 gröna. Om det återkommer: kör
  --reporter=verbose och logga namnen här.
- QA Q0 PUSHAD (8a649b4) + första qa-daily (run 39603952998, rapportera-bara) grön. Spec: .claude/spec-qa-automation.md; kod: qa/, qa-daily.yml.
  Ägarbeslut 2026-10-21: GitHub-notiser; Opus 5.5 (ANTHROPIC_API_KEY finns); WAF/QA_BYPASS_TOKEN VÄNTAR -- skapas bara om Cloudflare
  utmanar GitHub-trafiken (första körningen: 0 utmaningar, alla 327 sidor 200, ingen cf-mitigated); CLAUDE.md regel 12; /about-
  syskonsajtstycket permanent undantaget via data-qa-allow-sibling-sites (markup, ej waiver). Vakthunden öppnar GitHub-issue (ej ALERT_WEBHOOK).
  BASLINJE (faktisk): 108/140/79 sidor (Brookings/Moreno/Broomfield), 0 verkliga fynd efter brusfilter; råa fynd var web.console
  (egna aborter + Cloudflare challenge-platform-skript), qa.tracking (Cloudflares kant-injicerade cloudflareinsights-beacon, ej sajtkod),
  web.leak /about (före deploy av undantaget; Moreno deployades senast). Körtid ~1-2 min/stad (ej 5-7), requests_total 1 900-4 000/stad/körn.
  Lokal commit EJ pushad: brusfilter + cf-mitigated-detektion + README-siffror (väntar på ja). GA4 laddas aldrig (samtycke förinställt).
  Brusfilter-committen pushad (fc459f9). Baslinjen godkänd av ägaren.
- QA Q1 KLAR (lokal commit, EJ pushad): Pass A utan bilder/typsnitt/media, Pass B (nyckelsidor x desktop/mobil x ljust/mörkt, axe-core
  som site-devDependency, bilder bara i ljusa kombon), Pass C (klocka 07:00/19:00/23:30 stadstid på /today,/events,/), nya kontroller
  web.axe/-minor, web.empty, web.clientfill, web.stale-alert, web.past-event, web.extlink; länkar utanför sitemap + externa bara måndagar
  (--links on) eller via dispatch-input. BESLUT: pastEvent-proben speglar lib/local-day.ts eventEndsAt (end gäller bara om > start, annars
  start+3 h) -- Moreno har data-end == data-start. Anrop/körning (länkar av): Brookings 1 335, Moreno 1 579, Broomfield 1 118 = ~4 000/dygn
  (var ~8 000). Måndagslänkpass: Brookings 405 interna + 392 externa, ~8 min p g a 1 s/host.
  FYND (riktiga, Q1-baslinje lokalt): web.axe 14/14/10 (Brookings/Moreno/Broomfield): color-contrast på time/kicker/.marquee-card__when i ljust
  läge (+1 mörkt), scrollable-region-focusable på .hourly (/weather/); inga web.empty/clientfill/stale/past-event efter proben fixats.
  Nästa: ägaren tittar på axe-fynden; Q2 (DB-invarianter) eller trig av QA_REPORT_ONLY=0 efter triage.
- Kontrastfix KLAR (lokal commit, EJ pushad -- pushas ihop med nav fas 1 = en omcrawlning): --ink-faint ljus #8a8a82->#6b6a63, mörk ->#9b988e,
  .hourly tabindex/aria, bygg-gaten utökad (ink-soft/faint på paper/surface/tints i båda lägen). Pass B axe före/efter (lokalt bygge):
  Brookings 14->0, Moreno 14->0, Broomfield 10->0. (Övriga lokala fynd = /img/ticketmaster saknas på statisk testserver, ej regression.)
- PRIORITET (ägaren 2026-10-21): sektionsnavigering fas 1 (spec: .claude/spec-section-nav.md) FÖRE Q2. Avvikelse från specen: commit lokalt per
  steg, pusha inte utan ja. Moreno/Broomfield: inventera + föreslå tabs/groups, VÄNTA på ja innan de byggs. Fas 2 (sammanslagning) = bara
  granskning efter fas 1, ingen kod.
- Arbetsregel: Idéer läggs i backlog.md, avbryter inte pågående arbete. Läs backlog.md bara när ägaren ber om nästa steg.
- NÄSTA: Val fas 2 (se överst), sen Kö 9 Steg 2/3, Glasgow, Q2.

## 2. Kö (bara pågående + närmaste 3 steg; resten i .claude/backlog.md)
ORDNING (ägaren 2026-10-21, uppdaterad): 1) Nav fas 1 görs klar parallellt med 2) VAL FAS 1 klar fre 23 okt; 3) helgen 24-25 okt GLASGOW;
4) mån 26 okt VAL FAS 2 (2a-inventering först, rapportera innan kod).
1. NAV FAS 1: KLAR för alla tre städer + committad lokalt (EJ pushad). Push-beslut (ägaren 2026-10-21): kontrastfix + nav + /vote pushas i ETT svep fre 23 okt
   när /vote är klar (en omcrawlning). Konfig godkänd: Brookings (båda antaganden), Moreno tabs today/events/whatson/cityhall/traffic/facilities/workplace
   (Home sales i Work & Home), Broomfield tabs today/cityhall/facilities/whatson/traffic/jobs (6 flikar, BESLUTAT: behåll sex). Gamla headern + MORE-koden borttagna; `nav` är obligatorisk i SiteConfig. Spec: .claude/spec-section-nav.md.
   Fas 2 (sammanslagning) = bara granskning, ingen kod. Glasgow: samtycke v1 = egen opt-in-banner, GA4 först efter ja, inga annonser; Google CMP när AdSense blir aktuellt;
   Glasgow-raden i live-DB godkänd när skelettet är klart.
   FÖRE FREDAGENS PUSH (ägaren 2026-10-21), ska göras i samma push som nav:
   a) KLAR 2026-10-21 (lokal commit): section-nav-ui.test.ts loopar över alla tre städernas riktiga nav-konfig (33 tester gröna i Edge): en rad, ingen sidscroll, All inom viewport, sheet stänger på alla sätt, fokusfälla. axe ljust/mörkt ligger kvar i QA Pass B (kräver sajtens CSS-variabler), ej i enhetstestet.
   b) /vail-resorts/ (Broomfield) visar Vail Resorts teasers ORDAGRANT. Kontrollerat 2026-10-21: live-sidan är INDEXERBAR (ingen noindex, ligger i sitemap-0.xml).
      KLART (lokal commit, ingår i nav-pushen): ägaren valde rubrik + datum + länk, ingen teasertext/kategorier; noindex i sidan + ur sitemap (astro.config.mjs
      noindexThinPageUrls). Broomfield-bygge: sitemap 79->78, sitemap/noindex-kontrollen OK, robots noindex,follow, 0 teaser i HTML.
2. VAL FAS 1 (/vote, alla tre städer, klar fre 23 okt): .claude/specs/election-2026.md. Hårda regler: ingen AI-text, endast officiella källor,
   käll-URL per datum/adress (bygget failar annars), fail closed. Ägaren 2026-10-21: commit lokalt per steg, pusha EJ utan ja (ihop med kontrast + nav).
   STEG 1 KLAR (lokal commit): site/src/pages/vote.astro, lib/election.ts (+test), config/election.ts (data per stad, checked_on 2026-10-21),
   page-meta 'vote', astro.config (sitemap-gating + noindex 30 d efter valet). Bygge alla tre OK (sitemap 109/141/79, disjoint OK), vitest 1244 gröna.
   BESLUT: data i config/election.ts (ej SiteConfig); varje fält har source_url som måste stå i sources + värd på officialHosts, annars kastar sidan = bygget faller;
   passerade datum visas som "Passed" (genomstruket), dagräkning räknas om i webbläsaren i stadens tidszon.
   AVVIKELSER MOT SPECEN: Broomfield postade valsedlar 2 okt (broomfield.org), ej 9 okt. voteinfo.net ligger bakom Cloudflare-utmaning (ej kringgått) -> Moreno-datum
   från rivco.gov + ROV:s vote center-PDF; spec-URL node/1276 ej läst/citerad. Brookings: ingen kontestlista publicerad av countyt, inga drop boxes (ej officiellt belagt),
   öppen fråga om kommunala nov-val OBESVARAD (ej belagd, publiceras ej). Moreno registreringsdeadline ej officiellt belagd -> utelämnad.
   STEG 2 KLAR (lokal commit): CityStatus-modul 'election' ("Election Day: Tue Nov 3 · How to vote", null dagen efter), nav-sektion 'vote' ("Election 2026", footer "How to vote",
   i All-sheet-gruppen Now, EJ som tab), RelatedContent 'How to vote' först på /city-hall + /events t.o.m. valdagen. Stänga av: election.enabled=false + ta bort 'vote' ur nav-groups (bygget säger till).
   FULLT BATTERI GRÖNT 2026-10-21 efter steg 2: vitest 1246, pytest 942, astro check 0 fel, bygge x3 OK, sitemap/noindex-disjoint 109/141/79.
   PUSHAD 2026-10-21 (e126a24, kontrast + nav + /vote + vail, ägaren godkände avvikelserna); /vote live 200 på alla tre. Moreno: CA-deadline 19 okt + villkorad reg. 20 okt-3 nov från sos.ca.gov.
   IndexNow: fanns ej i repot -> nyckelfil site/public/1fdbd9a2782398d4ca47d6c335de0ecf.txt (publik per design) + POST api.indexnow.org, 202 för /vote på alla tre. Ägaren kollar telefon. Fas 1 KLAR.
3. GLASGOW (helgen 24-25 okt): .claude/specs/glasgow-loop.md. Fas 0 (rapport docs/uk-audit.md, stanna) -> fas 1 (landsprofil, US byte-identiska) ->
   fas 2 (skelett) -> snabbaste källor: Ticketmaster GB, Adzuna gb, Met Office (när nyckel finns), kommunens möten. Mål: scrapers igång och data
   samlas från dag ett; noindex av när första riktiga datan flödar. COMMITTA INGET förrän ägaren säger till. Inga referenser till ägarens arbetsgivare.
4. VAL FAS 2: 2a KLAR + ägarbeslut 2026-10-21 (se .claude/election-2a-inventory.md, avsnitt Beslut). Moreno: /election-results visar BARA "Official results: Riverside County Registrar of Voters" + länk, inga egna siffror, tills ägaren sagt ja till ROV-åtkomst (mejlutkast i inventory-filen; ägaren skickar). Broomfield = Clarity ENR (JSON/XML). SD = XLSX per county. Ingen adapterkod ännu.
5. Kö 9 Steg 1 -- väntar på ägarens punkter 1-5 (se Nu) + Steg 2, Steg 3 (text nedan).
6. QA Q2 (DB-invarianter), sedan Q3-Q4: .claude/spec-qa-automation.md.
   Q4-lista: + utred section-nav-ui CI-flakiness (se FLAKY ovan) innan timeouterna får stå kvar som slutlösning.

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
  UTGÅNGSDATUM: 2027-10-21 (1 år avsiktligt, ägaren 2026-10-21). Påminnelse senast 2027-10-07.
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
