# GEO-spec (generative engine optimization) -- 2026-11-04, ENDAST SPEC, inget byggt

Mål: att AI-sökmotorer (ChatGPT search, Perplexity, Claude, Google AI-översikter, Copilot) hittar, förstår och citerar våra sidor, och att vi kan MÄTA om det händer. Redaktionella grundregeln gäller: en sida finns för att besvara en invånares fråga, så GEO här betyder "svaret först, källan synlig, maskinläsbart", aldrig text skriven för bottar.

## Nuläge (läst 2026-11-04, ingen kod ändrad)
- llms.txt FINNS redan och är live (HTTP 200) på alla fyra: brookingsview.com 8,3 kB, morenovalleyview.com 13,4 kB, broomfieldview.com 9,9 kB, glasgowloop.co.uk 4,1 kB. Genereras vid bygget av site/src/pages/llms.txt.ts ur samma klustergraf som navet (computeTownGraph), länkar hubbar och anläggningssidor, aldrig enskilda nyheter; medvetet ingen llms-full.txt.
- robots.txt har inga regler mot AI-botar på någon av de fyra (0 träffar på GPTBot/ClaudeBot/anthropic-ai/PerplexityBot). Cloudflare "Block AI bots" och "Managed robots.txt" ska vara AV (ägarens lista); kontrolleras i steg 0.
- AI-botar loggas redan: tabellen ai_crawler_hits (migration 044; town_id, crawler_name, path, user_agent, created_at) fylls av site/server/ai-crawler-log.ts för GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, CCBot, Google-Extended, Bingbot, Googlebot. Ingen IP, ingen cookie, bara botens egen user-agent.
- GA4 finns på de tre US-sajterna (ga4MeasurementId i site-config). Glasgow har ingen GA4 (PECR: får inte laddas före samtycke, byggs medvetet avbrutet i BaseLayout). Glasgow mäts därför bara via ai_crawler_hits och Cloudflare Web Analytics.
- JSON-LD finns i flera moduler (article-jsonld, event-jsonld, ticketmaster-jsonld, Organization i BaseLayout, breadcrumbs); ingen samlad inventering av vilken sidtyp som har vilken typ.

## Punkt 1: llms.txt för alla fyra (finns; kvar är kvalitet)
Förslag, i denna ordning:
1. Verifiera att filen är rätt per stad, inte bara att den finns: inga länkar till avstängda sektioner (Glasgow: traffic, jobs, reviews ...), inga noindex-sidor, inga länkar som ger 301/404 (länkkontroll mot bygget). Lägg som QA-kontroll `geo.llms-links` (born_from denna spec).
2. Lägg till de nya guiderna (Brookings /winter-guide/, /trash-recycling/, /game-day/ m.fl.) och /tonight/ + /this-weekend/ där sidorna är indexerbara; Glasgow får /today/, /whats-on/, /weather/.
3. Första raden under rubriken ska vara en sats om vad sajten ÄR och inte är ("oberoende lokal informationssajt, ingen myndighet; officiella besked finns hos staden"), eftersom en AI-motor annars kan återge oss som källa för officiella beslut.
4. "Refreshed every 6 hours" är fel för Glasgow om cron skiljer sig; läs värdet ur config, skriv inte in det för hand.
Inget llms-full.txt (tidigare beslut kvarstår).

## Punkt 2: server-renderat innehåll
Fråga: vilka sidor visar sitt svar bara efter att JavaScript körts? En AI-hämtare kör normalt inte JS.
- Känd lista att granska: /today/ (klientfyllda delar: aktuell temperatur, dolda avslutade rader), /tonight/ och /this-weekend/ (hide-ended, sammanfattningsrad som räknas om i webbläsaren), /election-results/ (HELA resultatet hämtas i webbläsaren; server-HTML har bara "Results will appear..."), /safety/ (läser /api/safety i webbläsaren), facility-sidornas öppen/stängd-badge, CityStatus.
- Metod: hämta varje sidtyp med curl (utan JS) för alla fyra städer, extrahera synlig text, jämför mot renderad text (Playwright finns redan i qa/web). Mät: andel av sidans svar som finns i rå-HTML.
- Regel: byggets HTML ska innehålla en fullständig, om än något gammal, version av svaret ("Updated <datum>"); JS får bara förfina (dölja avslutat, räkna om). Fall där rå-HTML saknar svaret rapporteras som `geo.server-render`.
- Valresultat är undantaget som motiveras: de är flyktiga och ska inte cachas som statiska fakta av en AI-motor; där är en tydlig text "live-resultat laddas i webbläsaren, officiell källa: <länk>" i rå-HTML rätt lösning.

## Punkt 3: svaret först
- Varje indexerbar sida ska ha svaret i de första ~2 meningarna under H1 (för guider: "Kort version" som på /winter-guide/). Frågerubriker (H2 som en fråga en invånare ställer: "När måste jag flytta bilen?") på guider.
- Mät med ett skript över bygget: ledtexten finns, är 20-60 ord, innehåller ingen "Welcome to"/"This page" och upprepar inte titeln. Rapport per sidtyp, inga automatiska omskrivningar och ingen AI-text (samma regel som meta descriptions 2026-11-03).
- Last updated + källa: synliga datum i text (inte bara i JSON-LD) på alla sidor som bygger på officiella uppgifter; "checked <datum>" finns redan på guiderna.

## Punkt 4: JSON-LD-granskning
1. Inventera: per sidtyp och stad, vilka @type finns (Organization/WebSite, BreadcrumbList, Article/NewsArticle, Event, LocalBusiness/Place för anläggningar, FAQPage?) -- skript som läser bygget och skriver en tabell.
2. Regler att granska mot: bara det som syns på sidan (Googles krav), inga uppgifter som inte finns i texten, datePublished/dateModified = sant datum (lastmod-karta finns), Event bara med riktig plats+tid, ingen Review/Rating-markup utan riktig recension. Anläggningar: openingHours bara om place_hours-rader finns.
3. FAQPage endast där sidan faktiskt har synliga fråga-svar (guiderna); validera mot schema.org-validatorn i QA lokalt, inte som extern tjänst i CI.
4. Fynd blir QA-kontroller (`geo.jsonld-*`) med born_from, plus fixtur.

## Punkt 5: AI-trafikrapport (veckovis)
Datakällor:
- ai_crawler_hits: antal träffar per crawler_name, stad, vecka; mest hämtade sidor (topp 20) per crawler; skillnad mot föregående vecka. Skillnad mellan träning (GPTBot, ClaudeBot, CCBot, Google-Extended) och svar/citat (OAI-SearchBot, ChatGPT-User, Claude-User, Claude-SearchBot, Perplexity-User): det senare är det som motsvarar en människa som ställde en fråga.
- GA4 (US-städer): sessioner där källa/hänvisare är chatgpt.com, perplexity.ai, claude.ai, copilot.microsoft.com, gemini.google.com, you.com, duckduckgo (AI) m.fl.; landningssidor; engagerade sessioner. Hämtas via GA4 Data API (kräver tjänstekonto/nyckel som ÄGAREN lägger; tills dess exporterar ägaren CSV till .claude/gsc/ eller .claude/ga4/).
- Glasgow: ingen GA4, ingen hänvisarloggning (privacy-löftet gäller). Rapporten visar bara ai_crawler_hits för Glasgow och säger det rakt ut.
Leverans: scripts/ai_traffic_report.py -> .claude/reports/ai-traffic-<ISO-vecka>.md (en tabell per stad + tre meningar: vad ändrades, vilka sidor citeras/hämtas, vad ska göras). Körs som workflow_dispatch + måndagstick i cron-dispatchern (ingen ny cron); LÄSER bara databasen (ingen live-skrivning, ingen migration behövs).
Gränser: en bots träff är inte en citering; rapporten får inte påstå att en sida "citeras" utan en hänvisarsession i GA4 som visar det.

## Ordning (förslag) och godkännande
0. Kontroll (läsning): Cloudflare AI-botinställningar, robots.txt x4, llms.txt-länkkontroll.
1. Server-render-inventering (rapport, ingen kod).
2. JSON-LD-inventering (rapport, ingen kod).
3. Åtgärder ur 1-2 i små commits med QA-kontroller.
4. llms.txt-ändringar (punkt 1).
5. Veckorapporten (punkt 5).
Inget byggs förrän ägaren sagt ja till ordningen. Frågor till ägaren: (a) GA4 Data API-nyckel eller manuell CSV? (b) ska /election-results/ få statisk reservtext (se punkt 2)? (c) ska llms.txt få en "om oss"-sats enligt punkt 1.3?

## Ägarens beslut 2026-11-04
Ordningen godkänd med en ändring: GA4-exporten (steg 3/punkt 5) ska ha dimensionen Week (inte Date) tillsammans med Session source/medium och Landing page + query string. Mått: Sessions, Engaged sessions. Börja med steg 1: reservtext på /election-results/ (gjort lokalt 2026-11-04, ej pushat). Inget pushas utan ägarens ja.
