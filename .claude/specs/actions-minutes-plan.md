# Plan: Actions-minuter under 2 000/mån (2026-10-28, väntar på ägarens godkännande; inga workflows ändrade)

Läget: privat repo = 2 000 gratis min/mån, ~5 000 förbrukade senaste 30 d. Inga timing-data finns i repot och `gh` saknas, så modellen nedan är UPPSKATTAD (byggtider: Brookings ~4-5, Moreno ~10-19 [19 lokalt, Ticketmaster + tusentals /s/-sidor], Broomfield ~4, Glasgow ~4 min; +3 min setup/npm ci per jobb). **Ladda ned Settings > Billing > Usage (CSV) och lägg i .claude/gsc/ eller skicka siffrorna per workflow: då kalibrerar jag modellen innan steg 2.** Relativa besparingar är robustare än absoluta tal.

## Var minuterna går idag (det som kan läsas ur workflows, ingen har concurrency eller villkor)
Varje stad bygger och deployar HELA sajten vid: scrape 4x/dygn (cron-dispatchern, `0 */6`), daily-content (1x/dygn), weekly-roundup (varje natt 23:00 + måndag), whats-on-intro (Brookings, varje natt), jackrabbits-season-digest (Brookings, varje dygn), closure-watch (vardagar, Brookings+Moreno), digests (veckovis/månadsvis), samt `deploy.yml`/`moval-deploy.yml`/`broomfield-deploy.yml` vid VARJE push (alla tre städer, även vid docs-/state-ändring). Brookings: ~8-9 byggen/dygn, Moreno ~7, Broomfield ~6, Glasgow 4. Dessutom `tests.yml` på varje push (3 jobb x npm ci), qa-daily 3 matrisjobb dagligen (Playwright-installation varje gång), scrape-liveness 4x/dygn.

## Modell (min/mån, ogrundad uppskattning, ordning = ägarens ordning)
| Steg | Åtgärd | Modell efter steget | Anm. |
|---|---|---|---|
| 0 | Dagens läge | ~10 900 (observerat ~5 000) | skalfaktor ~0,46 till observerat |
| 1 | Push-deploy: `paths:`-filter per stad (shared = alla fyra, `.claude/**`, docs, `*.md` = ingen), `concurrency` (cancel-in-progress) på alla deploy-/scrape-workflows; tests.yml `paths-ignore` docs + cancel | ~10 300 | -450 deploys vid push, -70 tests |
| 2 | Bygg bara när data ändrats + scrape 2x/dygn (US + Glasgow): scraper/publish skriver `changed=true/false` (nya/ändrade rader i events/meetings/stories/alerts/facilities; trafik och väder-observationer räknas INTE), bygget hoppas över annars; `npm ci`+Playwright flyttas efter kontrollen. Dispatcher `0 6,18` (i stället för `*/6`); scrape-liveness 18 h -> 26 h och 2x/dygn | ~6 900 | störst: scrape-körningar 480 -> 240, med byggen ~hälften |
| 3 | Nattliga roundups/whats-on/jackrabbits/closure bygger bara vid ny text (python-steget skriver `changed`); **struktur:** daily-content, roundup och digests flyttas in i morgonens scrape-cykel så EN build/deploy täcker dem (3b, större ändring, egen godkännandepunkt) | ~5 600 (3a) / ~4 800 (3b) | |
| 4 | Bygg inte gamla noindex-detaljsidor (se nedan) | ~4 500 | främst Moreno |
| 5 | qa-daily: Pass A var 3:e dag (`date +%j` mod 3), Pass B/C dagligen bara nyckelsidor, cacha Playwright-webbläsare | ~3 800 | |
| 6 | Gitleaks som lokal pre-commit-hook (`.githooks/pre-commit` + `core.hooksPath`, `winget install gitleaks`); ingen CI-kostnad, påverkar ej minuter | ~3 800 | enbart säkerhet/ersätter inget Actions-steg i dag |
| Skalat med 0,46 | | **~1 750** | om kalibreringen stämmer; annars se hävstänger |

Räknat ärligt: modellen når <2 000 först efter steg 3b+4+5 OM skalfaktorn 0,46 är rätt. Behövs mer: (a) scrape var 12:e timme med byggen bara 1x/dygn för Broomfield/Glasgow, (b) QA Pass A en gång i veckan, (c) Moreno-bygget delas (se punkt 4).

## Punkt 4: gamla noindex-detaljsidor (förslag, mät först)
- Vad: `/s/<slug>/` för event/möten som passerat och är noindex (word-count-regeln <250 ord, passerade event) bygger bara statiskt; datan stannar i DB. Besökare via gamla länkar ska fortfarande få innehåll: antingen en lätt Worker-route som renderar sidan on demand, eller 301 till /events/past/ eller kategorisidan. **Beslut behövs:** 410/301 vs on-demand.
- Föreslagen gräns: event med `occurs_at` äldre än 60 dagar OCH noindex bygger inte egen sida (möten behåller sin: de är arkiv och indexerbara). Siffran fastställs när mätningen visar hur många sidor det är.
- Mätning: Moreno-bygget före = **pågår nu** (siffran från bygget som kör, lokalt 19 min / N sidor, loggas i /tmp/b4_moreno_valley_ca.log); efter = samma kommando med gränsen. Redovisas i state.md. CI-tid mäts när billing-CSV finns.

## Första steget att genomföra (efter ja), i den här ordningen
1. Steg 1 (paths-filter + concurrency): rent syntaktiskt, låg risk. Delad kod = `site/src/**` utom städernas egna config-filer, `site/astro.config.mjs`, `server/**`, `scripts/**`, `requirements.txt`, `package*.json`. Stadsspecifikt = `configs/<stad>.json`, `data/**/<stad>*`, `site/src/config/<gb>/**`.
2. Steg 5 (QA) och liveness-ändringen: små.
3. Steg 2 + 3a: ändrar scrape/publish så de rapporterar `changed` (kod i ai_pipeline/publish.py + scrapers/runner.py + workflows). Tester i pytest för changed-logiken.
4. Steg 4 efter mätning, 3b efter ägarens ja.
Rapportera förväntade min/mån efter varje steg (ägarens regel).
