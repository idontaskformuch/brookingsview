# Brookings View — komplett byggplan (gör rätt från grunden)

**Mål:** en varm, positiv, config-driven lokalsajt för Brookings på `brookingsview.com`
som besvarar *"Vad händer i Brookings?"* — kul och härlig, aldrig snaskig, aldrig
jail-/arrest-/obituary-innehåll. Byggd för att skala till 10+ orter där varje ny ort är
en config-fil, inte kodändring.

**Filosofi:** inga genvägar, inget slit-och-släng. Vi bygger varje lager på riktigt och
i rätt beroendeordning, och går live först när det är genuint bra. Ingen tidspress.

**Retrofit-fällor vi bygger rätt DIREKT** (billigt nu, smärtsamt senare):
proveniens/källspårning · dedup · full config-drivenhet · hallucinations-guardrails ·
trust/E-E-A-T-sidor · SEO-schema · tillgänglighet · cookie-consent.

---

## Arkitektur (låst innan bygge)

- **Frontend:** Astro, statiskt genererat, hostat på Cloudflare Pages.
- **Scrapers + AI-pipeline:** Python, körs schemalagt via **GitHub Actions cron** (samma
  mönster som Holizon). Python valt för att scraping/PDF-parsing (CivicEngage, Legistar)
  är mycket starkare där än i Workers.
- **Databas:** **Neon** (serverless Postgres, generös gratisnivå, riktig JSONB, skalar till
  fler orter). Alt: Supabase. Cloudflare D1/SQLite är möjligt om du vill 100 % Cloudflare-
  native, men tappar JSONB och Python-scraping — rekommenderas ej här.
- **Färskhet:** scrapers+AI skriver till DB → Actions pingar en **Cloudflare Pages deploy
  hook** → Astro bygger om och hämtar från DB vid build-time. Fullt statiskt, snabbt, bra
  SEO, billigt. Rebuild-kadens = innehållskadens (t.ex. varje timme).
- **Config-drivet:** all ort-specifik data i `configs/brookings_sd.json`. Ingen ort-logik
  hårdkodas i scraper-, AI- eller frontend-lagret.

## Mappstruktur
```
/configs
  brookings_sd.json
/scrapers
  /parsers        legistar_v1.py, civicengage_pdf_v1.py, smartgov_v1.py,
                  noaa.py, nws_alerts.py, sd511.py, usda.py, gojacks_v1.py, events.py
  /sources        (tunna wrappers som mappar config → parser → DB)
  runner.py       (läser config, kör aktiverade källor, loggar scrape_runs)
/ai_pipeline
  format_prompt.py
  guardrails.py
/db
  schema.sql
/site             (Astro-projektet)
/.github/workflows
  scrape.yml, build.yml
PLAN.md
```

---

## Stage 0 — Foundations & verifiering (INNAN parsers byggs)
Parsers beror på riktiga endpoints, så lös detta först:
1. Skapa repo, monorepo-struktur enligt ovan, lägg in configen.
2. Provisionera Neon-databas. Lägg secrets i GitHub Actions + Cloudflare env:
   `ANTHROPIC_API_KEY`, `DATABASE_URL`, `NASS_API_KEY`, `PAGES_DEPLOY_HOOK`.
3. **Verifiera källorna** (från configens `_verify_before_launch`):
   Legistar client_id (testa `webapi.legistar.com/v1/<id>`) · SDSU events-URL/iCal ·
   NWS county/zone-kod för Brookings County · SD 511-endpoint · SmartGov publik läsbarhet ·
   skolstyrelsens agendakälla · USDA NASS-nyckel.
   *Done när:* varje aktiverad källa har en bekräftad, hämtningsbar URL/endpoint.

## Stage 1 — Datalager (byggs innan scrapers skriver till det)
Postgres-schema, med det som är dyrt att retrofitta inbyggt:
- Kärntabeller: `towns`, `stories` (title, slug, body, source_type, published_at,
  town_id, **source_url**, **snapshot_id**, **generated_by**, **verified**).
- Innehåll per källa: `meetings`, `permits`, `events`, `sports_games`, `weather_snapshots`,
  `ag_prices`. (Ingen jail-/obituary-tabell — medvetet.)
- **`scrape_runs`** (source, started_at, status, http_code, items_found, error) — driver
  alerting.
- **`source_snapshots`** (raw HTML/PDF, hash, fetched_at) — bevis på vad källan sa +
  upptäcker när .gov-sajter ändrar struktur.
- **Dedup:** unik constraint / content-hash på meetings, permits, events, sports.
- Index på `(town_id, published_at)`.

## Stage 2 — Scrapers (var och en byggd + testad mot RIKTIG data)
Byggs plattformskeyade så de återanvänds för ort #2. Varje parser: hämta → snapshot →
skriv rådata → dedup → logga `scrape_run`.
- `legistar_v1` (city meetings, via webapi) — återanvänds direkt för alla Legistar-orter.
- `civicengage_pdf_v1` (county meetings).
- `smartgov_v1` (permits + business licenses).
- `noaa` (väder), `nws_alerts` (varningar), `sd511` (väglag), `county_alerts` (banner).
- `gojacks_v1` + NCAA-data (SDSU-sport).
- `events` (multi: parks&rec, bibliotek, SDSU-kalender).
- `usda` (råvarupriser).
*Done när:* varje aktiverad källa fyller sin tabell med korrekt, deduplicerad riktig data.

## Stage 3 — AI-formateringslager
- `format_prompt.py`: per-källa-mallar, batchad, varm/vänlig men strikt faktabunden ton
  enligt `configs → ai.tone_guidelines`. Ren strukturerad data (väder, matchtider,
  priser) templateras utan AI där det räcker; AI väver ihop till läsbara digests med kontext.
- `guardrails.py`: **extraktiv validering** — avvisa output som innehåller egennamn,
  siffror eller påståenden som inte finns i källdatan; ingen åsikt om kontroversiella
  civik-frågor; blockera allt som rör `editorial.never_publish`.
- Kostnadskontroll: batch, cache, månadsbudget-tak (`ai.monthly_budget_usd`).
*Done när:* en testkörning ger vänliga, korrekta digests och guardrail avvisar en
medvetet planterad hallucination.

## Stage 4 — Frontend (Astro, config-drivet, matad av DB)
- Designsystem enligt `frontend-design`: varm, ljus, EN glad accentfärg, mobile-first,
  tillgängligt (semantisk HTML, kontrast, alt-texter) från start.
- Sidor: startsida (Hero → Today/väder → Jackrabbits → This Week/events → New in Town/
  permits) · sektions-indexsidor · digest-/story-sidor · **trust-sidor**: About, Contact,
  Privacy, Cookie, **Methodology** (E-E-A-T: hur datan samlas in, namngiven ansvarig,
  rättelsepolicy).
- SEO: `@astrojs/sitemap`, `NewsArticle` + `LocalBusiness` schema, `robots.txt`, OG-bilder,
  **RSS-feed**, favicon.
- PWA: `manifest.json` + service worker (offline-cache). Push förbereds men aktiveras i
  Stage 7 (iOS kräver "Add to Home Screen" först).
- Cookie-consent-banner (integritetsvänlig default), kopplad till framtida AdSense.

## Stage 5 — Automation & ops
- `.github/workflows/scrape.yml`: cron per källkadens → `runner.py` → AI-batch → ping
  deploy hook.
- **Alerting:** mejl när en scraper failar N gånger i rad (händelsestyrt underhåll, inte
  daglig övervakning).
- AI-spend-monitor mot budgettaket.

## Stage 6 — QA & compliance (innan launch)
- Innehållsgranskning + guardrail-audit (planterad-hallucination-test).
- Juridisk koll: bekräfta att INGET namngivet-privatperson-negativt innehåll finns någonstans.
- Cookie-consent + privacy policy faktakoll.
- Lighthouse (prestanda/tillgänglighet/SEO), mobil-QA.

## Stage 7 — Launch, sen AdSense
- Gå live på `brookingsview.com`. Aktivera PWA-push.
- **Låt innehållet ackumuleras i några veckor** — ansök om AdSense FÖRST därefter
  (vertoq-lärdomen: substantiellt innehåll + trust-sidor på plats före ansökan).

## Stage 8 — Skala till ort #2
- Klona configen (`configs/<town>.json`), återanvänd plattforms-parsers rakt av
  (Legistar m.fl.). Bygg bara ort-specifika, jail-fria källor. Den begränsande faktorn är
  antalet *unika plattformar*, inte antalet orter.

---

---

## Innehållsspår v1 — schemalagda krönikor/recensioner/recept

**Mål:** automatiserad, schemalagd innehållsgenerering ovanpå befintlig scrape-pipeline.
Publicera live så snart guardrails + minst 2 innehållstyper fungerar end-to-end.

**Justeringar mot ursprungsplanen** (beslutade innan bygge):
- `style_filter.clean()` är allmän stil-/läsbarhetspolering (konsekvent skiljetecken,
  whitespace, tonjustering) — INTE ett verktyg för att dölja AI-ursprung eller undvika
  AI-detektion. Sajten kan öppet ange att kolumnerna är AI-genererade.
- Inga innehållstyper namnges efter en riktig, namngiven offentlig person (t.ex. inte
  "stephen_fry_stil"). Stiltyper beskrivs generiskt (t.ex. "kvick, brittisk essästil"),
  aldrig kopplade till en identifierbar individ.
- **(2026-07-22) Modulnamn/source_type/kategorietiketter är engelska.** `kultur_essa`
  → `culture_essay`, `ledare` → `editorial` (inkl. CATEGORY-etiketterna "Kulturessä"
  → "Culture essay", "Ledare" → "Editorial"). Sajten är English-language rakt
  igenom (samma princip som språkfixet för AI-genererad text) — ett internt
  modulnamn eller en synlig kategorietikett på svenska är samma sorts avvikelse.
  `vetenskap_kronika`/`kvick_essa`/`media_recension`/`vardagsmiddag` är fortfarande
  svenska interna namn (flaggat, inte ännu åtgärdat på användarens begäran).

### Steg 1 — Guardrails (måste finnas innan något innehåll publiceras)
- `guardrails/style_filter.py`
  - `clean(text: str) -> str`: allmän stil-/läsbarhetspolering (skiljetecken, whitespace).
- `guardrails/originality_check.py`
  - `is_original(text: str, existing_corpus: list[str]) -> bool`: jämför ny artikel mot
    tidigare publicerade texter (n-gram/likhetscheck) för att undvika oavsiktlig
    nästan-dubblett-publicering — inte för att kringgå extern plagiatdetektion.
- Acceptanskriterium: kör båda mot 2-3 exempeltexter, verifiera att polering sker och att
  en nästan identisk text flaggas som icke-original.

### Steg 2 — Rotationsschema
- `scheduler/weekly_rotation.py`
  - Definierar vilken innehållstyp som körs vilken veckodag.
  - Enkel config-dict, lätt att ändra utan kodändring:
```python
    ROTATION = {
        "monday": "culture_essay",
        "tuesday": "editorial",
        "wednesday": "media_recension",
        "thursday": "vardagsmiddag",
        "friday": "vetenskap_kronika",
        "saturday": "kvick_essa",
        "sunday": "culture_essay",
    }
```
- Acceptanskriterium: funktion som givet ett datum returnerar rätt innehållstyp.

### Steg 3 — Innehållsgenerering (bygg 2 typer först för snabbast live-lansering)
Prioritera i denna ordning:
1. `content/kronikor/culture_essay.py` — DN Kultur-stil, tredjeperson, ingen personlig anekdot
2. `content/kronikor/editorial.py` — NYT-argumenterande stil

Sen (kan komma efter första livegång):
3. `content/kronikor/vetenskap.py` — tillgänglig, lekfull vetenskaplig förklararröst (generisk)
4. `content/kronikor/kvick_essa.py` — kvick, brittisk essästil (generisk)
5. `content/recensioner/media_recension.py`
6. `content/recept/vardagsmiddag.py`

Varje modul:
- Egen promptmall (systemprompt med stilregler inbyggda)
- Tar lokal vinkel/kontext som input där relevant
- Kör output genom `style_filter.clean()` och `originality_check.is_original()` innan den returneras
- Om `is_original()` == False → logga och skippa publicering, larma i Action-loggen

### Steg 3.5 — Tecknade bilder till artiklar
- `content/illustrations/generate_illustration.py`
  - Genererar en tecknad/illustrerad bild per artikel (krönika/recension), matchat till
    textens tema. Körs efter textgenerering + guardrails, innan commit.
  - Bildstil: konsekvent tecknad stil över hela sajten via en delad `STYLE_PROMPT`
    (`config/image_model.py`) — ingen fotorealism, inga riktiga identifierbara personer
    (samma princip som textinnehållets permanenta guardrails).
  - Output: sparas i `assets/images/{slug}.png`.
- `config/image_model.py`: `IMAGE_MODEL` ("flux"/"sdxl") och `IMAGE_API_PROVIDER`
  ("fal"/"replicate") + `MODEL_IDS`-tabell + `STYLE_PROMPT`, separat från modellvalet.
  Byte av modell/leverantör kräver bara en config-ändring, ingen kodändring i
  `generate_illustration.py`.
- Kräver `FAL_KEY` eller `REPLICATE_API_TOKEN` (beroende på `IMAGE_API_PROVIDER`) som
  secret — saknas ännu i `.env`/GitHub Actions, måste sättas upp innan Steg 3.5 kan
  köras live.
- Acceptanskriterium: en genererad artikel har en matchande bild committad och renderad
  på sajten efter full cykel. Modellbyte flux→sdxl kräver ingen kodändring, bara config.
- **Status:** klart och live från och med 2026-07-21. `[slug].astro` faller tillbaka på
  `/og/{slug}.png` (OG-kortet) som hero när `image_path` är NULL — det är avsett, inte
  ett buggigt mellanläge.
- **Beslut (2026-07-21): illustrationer gäller endast framåt.** Artiklar publicerade innan
  Steg 3.5 kopplades in (t.ex. `editorial-2026-07-21`, då publicerad som `ledare-2026-07-21`
  -- se namnbytet till engelska ovan) förblir PERMANENT utan bild.
  `image_path IS NULL` på dem är avsett, inte en lucka att fylla i efterhand — skriv
  ingen backfill-migrering eller batch-jobb som genererar bilder retroaktivt för
  historiska artiklar.

### Steg 4 — Integrering i GitHub Actions
- Ny separat workflow (INTE i den befintliga hourly scrape-Action):
  - `.github/workflows/daily-content.yml`
  - Körs 1 gång/dag, kollar `weekly_rotation` för dagens typ, genererar, kör guardrails, committar/publicerar
  - Använder samma `PAGES_DEPLOY_HOOK`-secret som redan är på plats
  - Fail loudly om secret saknas (samma mönster som scrape-fixet)

### Steg 5 — Go-live
- Kör steg 1-4 med bara culture_essay + editorial live först
- Verifiera en full cykel (generering → guardrails → commit → Cloudflare rebuild → syns på sajten)
- Lägg till resterande innehållstyper i egen takt utan att blockera lansering

### Definition of Done för v1-lansering
- [ ] Guardrails körs och blockerar korrekt icke-original text
- [ ] Minst 2 innehållstyper (culture_essay, editorial) genererar och publicerar automatiskt
- [ ] Söndagsrotation bekräftad i schemat
- [ ] Ny daily-content workflow committad och grön i Actions
- [ ] Sajten visar nytt innehåll efter en full körning

---

## Permanenta guardrails (alla stadier)
- Publicera ALDRIG arrest/jail/mugshot/obituary/anklagande innehåll om namngivna
  privatpersoner. Vi beskriver händelser, lag, platser och trender — aldrig anklagelser
  mot enskilda.
- Allt faktiskt korrekt. AI-lagret hittar aldrig på namn, siffror eller citat — det väver
  bara ihop det som finns i källdatan, i en varm och vänlig ton.
- Om något kan tvinga fram en borttagning senare bygger vi inte in det från början.
