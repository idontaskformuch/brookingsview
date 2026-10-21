# State (komprimerad 2026-10-21)

Historik: se .claude/state-archive.md, läs bara vid behov.
Aktiv spec: .claude/spec-time-alerts-heroes.md (Fas 0-5 klara, Fas 6 kvar).

## 1. Nu
- origin/main = 1d2648a. Lokalt 2 opushade docs-commits ovanpå (state.md + moreno-duplicate-meetings.sql), bara .claude/-filer.
  Allt annat är pushat: Fas 1-5, Hobo Week -> campus, skyltremsa med sport, top_events-marquee,
  månadsvisa sektionsheroes, bildbeslut 2, neutral User-Agent, Broomfield-stadskalendern, komprimerad state.
- ÅTGÄRD 1 (GÖR FÖRST I NÄSTA SESSION, FÖRE FAS 6): Kontrollera scrape_runs för körningar efter
  2026-10-21 05:35 UTC, alla tre städer, rapportera 403/fel.
  (User-Agent byttes till "ViewMediaBot (+https://<stad>view.com/contact)" och pushades 05:35Z; schemalagda
  scrape-körningar går var 6:e timme med flera timmars försening. Fråga: SELECT town_id, source_key, status,
  http_code, error, started_at FROM scrape_runs WHERE started_at >= '2026-10-21 05:35+00' ORDER BY started_at;
  baslinje före bytet: 28 körningar sedan 02:00Z, 0 st 403, bara de kända 'stub'/'skipped'. Jämför med
  data.cotrip.org som redan gav 403 med gamla UA. Vid 403: lägg tillbaka den gamla UA-formen för just den
  källan via USER_AGENT i dess workflow, rapportera till ägaren.)
- ÅTGÄRD 2: Fas 6 (dark mode) enligt spec. Commit per steg, pusha inte utan ja.
  STATUS_TOKENS.dark läggs i site/src/lib/status-tokens.mjs; kontrasttestet körs då på båda lägen.
- ÄGAREN KÖR SJÄLV: .claude/moreno-duplicate-meetings.sql i Neon-konsolen (se Kö 6).

## 2. Kö
1. Fas 6 dark mode (spec). Börja på Brookings, sedan alla tre. Skärmbilder i båda lägen.
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
6. Moreno Valley dubblettMÖTEN (rader i `meetings`, INTE bilderna -- bilddubbletterna school_alerts-4/
   sports-5 är redan denylistade). SQL för ägaren att köra själv: .claude/moreno-duplicate-meetings.sql
   (SELECT -> referenskontroll -> DELETE i transaktion med guard -> kontroll-SELECT). Verifierat read-only
   2026-10-21: inget refererar 13786/13788 (6 FK-tabeller 0 rader, inga stories för något av de fyra
   id:na, inga slugs/URL:er/redirects i DB eller repo); guarden matchar exakt 13786 och 13788.
   Ta bort punkten när ägaren har kört den.
7. QA #9 Celebration Park-öppettider (Moreno, info, lägst prio).

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
