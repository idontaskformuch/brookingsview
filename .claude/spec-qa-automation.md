# Spec: automatisk QA av alla sajter (PLAN 2026-10-21 -- EJ godkänd, inget byggt)

## Utgångsläge (befintligt som återanvänds)
- site/package.json har redan playwright-core; scripts/check_deployed_content.py (live-fräschhet efter deploy),
  scripts/check_source_staleness.py (+ scrapers/staleness.py, dagligen), scripts/scan_contamination.py (stadsläckage i
  stories/facilities/events), ai_pipeline/town_guard.py (blocklistor), scripts/check_scrape_liveness.py, lib/status-tokens.mjs.
- Sitemap: Brookings 109, Moreno 141, Broomfield 79 = 329 URL:er.
- GitHub-cron startar 4-9 h sent -> QA tål fördröjning (ingen tidskritisk assert på "körde exakt kl X"); startas av
  Cloudflare-dispatchern när den är deployad, annars av eget schedule.

## Arkitektur
- qa/ (ny mapp): qa/web/ (Playwright, Node), qa/db_invariants.py, qa/ai_review.py, qa/report.py, qa/known-issues.json
  (waivers med utgångsdatum + orsak), qa/checks.json (register: id, severity hård/mjuk, "born_from" = vilket fel som födde den).
- Workflows: qa-daily.yml (matris 3 städer; Playwright + DB-invarianter), qa-weekly-ai.yml (skärmbilder -> Claude).
- Mot LIVE-sajterna (som check_deployed_content), inte dist/, så Cloudflare/deploy-fel fångas.
- Playwright blockerar annons-/analysskript (adsbygoogle, googletagmanager, ...) via route.abort: QA-trafik får aldrig
  räknas som annonsvisningar/ogiltig trafik (AdSense-projektet!). Egen UA "ViewMediaQA (+<stad>view.com/contact)".
- DB-delen är bara SELECT (session sätts default_transaction_read_only=on). Inga live-skrivningar.

## 1. Playwright dagligen
Pass A (alla sitemap-URL:er, desktop 1280, ljust, riktig klocka): ~110-140 sidor/stad.
Pass B (nyckelsidor ~10/stad: start, /today, /events, /this-week, /whats-on, /city-hall, /weather, ...):
  mobil 390 + desktop, ljust + mörkt (4 kombinationer) ~40 laddningar/stad. axe-kontrast här + ett urval per mall i A.
Pass C (tidsresa med page.clock): /today, /events, start vid 07:00, 19:00, 23:30 stadstid ~27 laddningar/stad.
Kontroller (id -> hård/mjuk):
- web.status: HTTP != 200 / redirectkedja >2 (hård); trasig intern länk via HEAD, dedupad (hård); extern länk (veckovis, mjuk)
- web.img: <img> naturalWidth=0 / 404 (hård); saknad alt (mjuk)
- web.console: console.error / pageerror / misslyckad request (hård; kända tredjepartsbrus i waiver)
- web.literal: text "undefined|NaN|null|[object|--|{{|Invalid Date" i synlig text (hård)
- web.h1: != exakt 1 H1, dubbel <title>/H1, tom title, title==annan sidas (hård)
- web.empty: sektion med rubrik men utan innehåll, tom <ul>, "0 events" där data finns (hård på nyckelsidor, mjuk annars)
- web.clientfill: element med data-* för klientrendering som fortfarande är hidden/tomma efter 3 s (hård)
- web.stale-alert: varningsyta med slut < nu, eller utan slut > 24 h (hård)
- web.past-event: event under Today/Tonight med start+längd < nu (hård); Tomorrow-bucket med dagens datum (hård)
- web.leak: andra städers namn/orter/domäner i synlig text, metadata, JSON-LD, alt (blocklista från town_guard) (hård)
- web.axe: axe-core kontrast (WCAG AA) i ljust OCH mörkt (hård för serious/critical, annars mjuk)
- web.theme: mörkt läge: text/bakgrund-kontrast på kontrollerade tokens + inga hårdkodade vita ytor (mjuk, axe täcker det mesta)
- web.noindex/sitemap: noindex-sida i sitemap, sitemap-URL som är noindex/404 (hård; finns delvis i bygget)
Körtid (uppskattning, ej mätt): ~3 s/laddning inkl. kontroller, ~250 laddningar/stad, 3 parallella kontexter ->
~5 min + ~1,5 min setup (cachad npm, chromium) = ~7 min/stad-jobb, 3 jobb parallellt = ~8 min väggtid, ~21 fakt.min/dygn.

## 2. DB-invarianter dagligen (qa/db_invariants.py, ~1 min)
- dubbletter per källid: meetings (ID/EventId/id per town_id; migration 060 ger unika index -> kontrollera även att indexen finns),
  events (town_id,title,starts_at) över källor, stories slug/duplicerad titel+datum (hård)
- varningar utan sluttid / med ends_at < starts_at / starts_at i framtiden >1 år (hård) -- tabell för varningar bekräftas i Q2
- källa utan nya rader på X dagar: ÅTERANVÄND scrapers/staleness.py-trösklar (finns redan dagligen) -- QA lägger bara till
  "enda källan i events = NWS" (Broomfield-fallet), 0 framtida events per stad, 0 stories publicerade på N dagar (mjuk/hård per källa)
- scrape_runs: 403/401 senaste körningen, N fel i rad, körning >X h försenad (finns delvis i liveness) (hård)
- stories med published_at i framtiden, saknad bild/slug, stadsläckage via town_guard (hård)

## 3. Veckovis AI-granskning
~10 nyckelsidor/stad, desktop + mobil ljust = ~20 skärmbilder/stad, ett anrop/stad med checklista (layout trasig, text som
klipps, tomt, konstigt innehåll, fel stad, olämplig bild, mörkt läge vid 3 sidor om vi vill). Strukturerat svar (JSON), bara MJUKA fynd.
Kostnad (uppskattning, bildar ≈ 1,6k tokens/st): ~33k in + ~3k ut per stad. Priser (cachade 2026-10-06):
  Sonnet 5.5 ($2/$10 per M): ~$0,10/stad -> ~$0,30/vecka -> ~$1,3/mån (≤ ~$2,5 med tänkande)
  Opus 5.5 ($4/$20 per M):   ~$0,20/stad -> ~$0,60/vecka -> ~$2,6/mån (≤ ~$5 med tänkande)
Rekommendation: Opus 5.5 (visuellt omdöme, kostnaden är försumbar). Behöver ANTHROPIC_API_KEY som Actions-secret.
Körtid ~4 min/stad (skärmbilder) + ~1 min API. Ägarens godkännande krävs innan första betalda körning.

## 4. Rapportering
- Hårt fel -> GitHub-issue (en per fingeravtryck check-id + stad + URL-mönster; återkommande = kommentar, stängs efter 3 rena
  körningar). Mejl: GitHub mejlar via Notifications när issuen skapas (noll ny infra). Alternativ: Cloudflare Email Service. ALERT_WEBHOOK är inte satt.
- Allt mjukt + AI-fynd -> EN veckosammanfattning (ett issue "QA vecka YYYY-WW" + samma mejlväg), grupperad per stad/check, med trend.
- Workflow-körningen blir röd vid nya hårda fel (som scrape-liveness).
- Första körningen blir bruten (baslinje): kör först i "rapportera-bara"-läge, triagera, skriv waivers, slå sen på issues.

## 5. Regeln "varje manuellt fel blir en kontroll"
- Varje fel -> ny rad i qa/checks.json med born_from + en regressionsfixtur (qa/fixtures/<id>.html eller SQL-rad) som beviljat
  FAILAR före fixen. Förslag på rad i CLAUDE.md (kräver ägarens ja): "Manuellt funnet fel är inte klart förrän en QA-kontroll
  + fixtur finns, eller en rad i qa/checks.json motiverar varför det inte går."
- Retro (vad som HADE fångat felen från senaste veckorna; slutsatser från state.md/minnet, ej testade):
  | Fel | Fångas av |
  | /today Tonight/Tomorrow trasig live sedan Fas 1, alla städer (klientskript matchade inget) | web.clientfill, web.empty, Pass C (tidsresa) |
  | Broomfield tappade bucket-skriptet (villkorligt <script>) | web.clientfill + web.empty på Broomfield /today |
  | Mörkt läge-regressioner (Fas 6) | web.axe i mörkt, AI-veckogranskning dark-sidor |
  | Utgångna varningar / passerade event kvar | web.stale-alert, web.past-event, Pass C, DB: varning utan slut |
  | Culture-essä på fel stad (moreno_valley_ca) | web.leak, DB: town_guard på stories |
  | Moreno meetings-dubbletter (12 grupper) | DB: dubbletter per källid |
  | Broomfield /this-week tom (events = bara NWS) | web.empty, DB: enda källan = NWS, 0 framtida events |
  | UA-bytet / 403 från källor | DB: scrape_runs 403 senaste körning |
  | Schemakörningar >3 h försenade, content-outage 08-27 | liveness (finns) + check_deployed_content (finns) |
  | "unpublish" gatade aldrig sajten (published_at) | web.status/sitemap + DB: published_at-invarianter |

## Faser (en commit per fas, tester + build först; push bara med ja)
Q0 skelett + register + rapportering (issue/mejl, rapportera-bara) + Pass A-kärnkontroller (status/img/console/literal/h1/leak)
Q1 Pass B/C: matris, tema, axe, tidsresa, clientfill/empty/past-event/stale-alert
Q2 DB-invarianter
Q3 AI-veckogranskning (efter godkänd kostnad + secret)
Q4 retro-fixturer för retro-tabellen + CLAUDE.md-regeln + slå på issues efter baslinjetriage
Q4 (tillägg 2026-10-22): utred varför site/src/lib/section-nav-ui.test.ts timear ut på CI (föll vid 2 pushar; timeouts höjda till hook 90 s / test 60 s som tillfällig maskering). Mät beforeAll + första page.goto på CI; åtgärda orsaken, ta sedan bort höjningen.
Totalt ~3-4 arbetssessioner.

## Total körkostnad
Actions: dagligen ~21 + DB ~1 min -> ~660 min/mån + veckovis AI ~15 min/vecka (~60/mån) = ~720 fakt.min/mån
(+~15 % mot dagens 4 965). Repot publikt = 0 kr; om privat ≈ $4,3/mån marginellt ($0,006/min efter gratis kvot).
Claude: ~$1,3-5/mån. Totalt privat: ≈ $6-10/mån; publikt: ≈ $1,3-5/mån.

## Risker
- Cloudflare bot-skydd kan utmana GitHub-IP:n (lösning: egen UA + WAF skip-regel för QA-headern/IP, ägaren godkänner).
- Falska positiva i början (baslinje); flakiga kontroller (retry 1x, sen rapportera).
- Klocka/tidsresa kräver stadens tidszon i browser-kontexten (timezoneId).
- Konflikt med Kö 9 Steg 2 (concurrency/bygg vid ändring): QA ska inte trigga deploy.

## Beslut som ägaren måste ta
1. Mejlväg: GitHub-notiser (rekommenderas) eller Cloudflare Email Service.
2. AI-modell: Opus 5.5 (rek.) eller Sonnet 5.5; ANTHROPIC_API_KEY som Actions-secret.
3. WAF-undantag för QA mot Cloudflare (om utmaning visar sig).
4. Rad i CLAUDE.md för regeln i punkt 5.
