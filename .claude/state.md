# State (komprimerad 2026-11-05; all tidigare historik i .claude/state-archive.md, sök där på rubrikerna nedan)

## Nu: PREMIUM-PRESENTATION, Fas 1 (spec .claude/specs/premium-presentation.md, beslut .claude/specs/premium-decisions.md, regler .claude/standards.md)
- Fas 0 klar (rapport .claude/specs/premium-phase0-report.md). Fas 1: 1a standards.md, 1b tokens+typsnitt, 1c ui/-bibliotek+galleri KLARA. 1d Tonight på biblioteket KLAR (949c40d + skärmdumpar); NÄSTA 1e. Sedan 1e standard-layout-test (lib/ui/standard-layout.test.ts), 1f defekter (hscroll Moreno /sports/ + Brookings /trash-recycling/, Moreno /home-sales/ "0 most recent", alla med QA-kontroll+fixtur, regel 12).
- Ändrade filer 1b-1c: site/src/design/ui-tokens.css, site/src/components/ui/* (15), site/src/lib/ui/{ui-helpers,icons}.ts(+test), lib/ui-tokens.test.ts, pages/[design].astro (/_design/, bara BUILD_DESIGN=1, '/_design/' i astro.config noindexThinPageUrls), BaseLayout (--font-data = --font-ui, Plex Mono borta).
- BESLUT (ägaren, galleri-granskning 2026-11-05): hjälte clamp(3.5rem,16vw,5.5rem); kategorifärger max 6 PER SIDTYP (CATEGORY_SETS; Tonight: music,nightlife,family,sports,food,arts; civic bara Meetings/City hall); temperaturskala i stadens enhet (TEMP_BOUNDS_F konverteras, Glasgow °C, testat); Card/ikoner/FallbackTile behålls men ska vara lätta att byta (storlekar=tokens, ikoner bara via lib/ui/icons.ts); Chips >=3 träffar/chip, >=2 chips, inga siffror; AboutThisPage hopfälld men "Updated" synlig.
- Före/efter-skärmdumpar (390+1280, ljust+mörkt) för Fas 1 ska ligga committade i .claude/review/phase1/.
- Lokala commits ej pushade (pusha aldrig utan ja, regel 6): 392b561..88b2c7d + ev. nyare. Kontrollera `git log origin/main..HEAD` (klonen kan släpa, se memory).
## Fas 1 KLAR (väntar ägarens granskning, Fas 2 ej påbörjad)
- 1e: lib/ui/standard-layout.test.ts (ingen townId/country-gren eller stadsnamn i layoutfiler); 3 country===-grenar flyttade till countryProfile (tonight-cards bucketLabel, tonight.astro, HolidayPage).
- 1f (BESLUT: fix + QA-kontroll + fixtur, regel 12): home-sales "0 most recent" -> salesListLabel (lib/home-sales.ts), tom lista döljer filter/fotnot; QA web.zero-count (rubriker, ej tabellceller). Hscroll: web.hscroll i qa/web (elementkant vs screen.width, ej scrollWidth: mobil-emulering ger 980 överallt). Funna+fixade: Moreno /jobs/category/* (624 px), Brookings /trash-recycling/ (398, bara med fallback-typsnitt), Brookings /jackrabbits/ (397, med riktiga typsnitt). Moreno /sports/ reproducerades INTE. Fixturer tests/fixtures/qa_{zero_count,hscroll}_2026-11-05.json. KEY_PAGES +/sports/ /trash-recycling/ /home-sales/.
- Skärmdumpar före/efter: .claude/review/phase1/defects/ (Moreno före = worktree på e8848e2). american-spelling-testet föll på "colours" i [design].astro (1c) -> fixat.
- Batteri (2026-11-05): vitest 2090/2090, pytest 1229 pass/11 skip, astro check 0 fel, build x4 i sekvens OK (Brookings med BUILD_DESIGN=1), sitemap/noindex-disjoint OK x4, hscroll-svep 390 px rent på alla fyra (båda typsnittslägen). Broomfield/Glasgow/Moreno byggdes före de sista Brookings-only-ändringarna (trash/jackrabbits/[design]) som inte påverkar dem.
- Kvar att besluta: Moreno kvällsevents datum en dag fel (tidszon) -- ej i 1f, senare.
- Lokala commits ej pushade (regel 6).
## Fas 2 (väder) PÅGÅR -- Fas 1 pushad+live-smoke grön 2026-11-05 (a4d3338; 4 städer 200, Bricolage, ingen Plex, ingen hscroll 390, /_design/ 404)
- 2a KLAR: payload-utökning i lockstep (TS cron-dispatcher/src/weather/{metoffice,nws,util}.ts + Python met_office_site_specific_v1.py/noaa.py): valfria pop/feels/gust/uv/precip_mm + fetched_at; paritetsfixturer via scripts/make_weather_parity_fixtures.py (met_office_parity.json, nws_parity.json); /api/weather för fetched_at. Ingen Worker-deploy.
- Plan: 2b NWS gridpoints (feels/gust/precip, separat steg) -> 2c lib/weather-model.ts+test (hjälte, insikter, sol-tider) -> 2d ui-komponenter (HourStrip, DayRows) + weather.astro + live-weather -> 2e skärmdumpar .claude/review/phase2/ + batteri. Pusha INTE Fas 2.
- BESLUT: klientrendering delar strängrenderare (lib/ui/ui-html.ts) med Astro-komponenterna så live-uppdatering och bygge ger samma markup.
## Öppna spår (detaljer i state-archive.md)
- MEETINGS: nästa lilla uppgift ej byggd. Fas 3 i premium-spec ersätter delvis.
- AI-prosa bort överallt (beslut 2026-11-05); Fas 5 = ny /this-week/.
- Högtidssidor: omkontroll ca 2026-11-18 och 2026-11-23 (supervised).
- AdSense-mål = Broomfield (GSC-export saknas). Prioritet: Broomfield verifieras först.
## Nästa steg
Ägaren granskar Fas 1 (galleri, Tonight, defekter); stanna för OK innan Fas 2.
