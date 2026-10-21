# State (komprimerad 2026-10-21)

Historik: se .claude/state-archive.md, läs bara vid behov.
Aktiv spec: .claude/spec-time-alerts-heroes.md (Fas 0-5 klara, Fas 6 kvar).

## 1. Nu
- Fas 6 (dark mode) KLAR och pushad 2026-10-21 (ägaren godkände). Alla tre städer byggda, vitest 1148 +
  pytest 919 gröna, astro check 0 fel, sitemap/noindex OK (Brookings 109, Moreno 141, Broomfield 79).
  Ägaren kollar mörkt läge på telefon; inga Moreno/Broomfield-skärmbilder gjorda.
- ÅTGÄRD 1 (blockerar inget): kör scrape_runs efter nästa schemalagda körning (~09:00-09:30Z) och
  rapportera 403/fel: SELECT town_id, source_key, status, http_code, error, started_at FROM scrape_runs
  WHERE started_at >= '2026-10-21 05:35+00' ORDER BY started_at; (06:08Z hade 0 körningar startat).
  Vid 403: gamla UA-formen via USER_AGENT i den källans workflow, rapportera till ägaren.
- BESLUT Fas 6: --navy ljus (#9bbbe3) i dark, fyllda knappar inverteras av sig själva; nya variabler
  --sign-bg/--on-accent/--paper-tint; sektionsaccent via body --section-accent-l/-d + has-accent;
  tema i localStorage 'bv_theme'. Skärmbildsverktyg: playwright python, channel msedge.
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
6. UTRED (rapportera, ändra inget): varför skapades Moreno-dubbletterna meetings 13786/13788 2026-10-01
   (created_at 22:05:02Z, samma sekund för båda) trots det unika indexet från Phase B? Vilken kod skrev
   raderna? Täcker indexet eSCRIBE-guid + datum, eller bara content_hash? (Raderna delade raw_data->>'ID'
   och meeting_date med 2193/2194 men hade annan content_hash. Kontext: gammal hypotes i arkivet = ett
   ospårat engångsskript runt "mass insert" 1 okt som kringgick dedup_check_columns. Raderna är redan
   borttagna 2026-10-21; kolla ändå att samma sak inte kan hända igen.)
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
