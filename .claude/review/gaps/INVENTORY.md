# Inventering: sidor och moduler som fortfarande renderas med gamla komponenter (2026-11-05)

Bara läsning. Skärmdumpar 390 px, ljust, alla fyra städer, i den här mappen: `<stad>-<sida>-390-light.png`. Startsidan och /events/ före/efter ligger i `../phase4/`.

## Metod
- "Nya komponenter" = `components/ui/*`, `components/tonight/*`, `components/meetings/*`, `components/events/*`. En sida räknas som ny om den bygger sitt innehåll på dem.
- Räknat med `grep` över `site/src/pages/` före Fas 4-ändringarna: bara **/weather/, /tonight/, /city-hall/** (och /_design/) var på biblioteket. /events/ och startsidan flyttas i detta steg.
- Rangordning: **trafik finns bara för Broomfield** (`.claude/gsc/broomfield-pages.csv`, 3 256 exponeringar / 51 klick totalt, GSC). För de tre andra städerna saknas data; där följer rangen Broomfields siffror plus min gissning av sökintresse (samma som Fas 0). Sidans placering i navet har också vägts in.

## Rangordning (högst synlighet först)

| # | Sida | Broomfield GSC (expon./klick) | Gamla komponenter / mönster | Skärmdump |
|---|---|---|---|---|
| 1 | **/ (startsidan)** | 35 / 0 (men varje besökare) | OrientationHeader, CityStatus, QuickLinks, TopEventCard, MarqueeCard, WeeklyRoundup (AI), WeekendModule, StoryCard-floder för Today/This week/Coming up/Worth knowing (AI-text), LeadStory/SecondaryStory (berättelsekort, delvis AI), Tile-rail (väder, trafik, priser), SectionRule | `*-home-390-light.png` |
| 2 | **/vote/** | 625 / 29 (störst) | egen sidmarkup, inga bibliotekskomponenter, ingen hjälte ("dagar kvar" / resultatlänk) | `*-vote-*` |
| 3 | **/traffic/** | 199 / 6 | PageGuide överst, SectionHero (bild ca 290 px), SectionRule; tomt läge utan design | `*-traffic-*` |
| 4 | **/today/** | 7 / 0 | PageGuide, SectionHero, TodayBlock (396 rader, eget kortsystem); H1 först på y ~850-1030 | `*-today-*` |
| 5 | **/facilities/** (+ /facilities/[slug]) | 149 / 0 | SectionRule, egna kategorilistor; ingen "Open now"-hjälte | `*-facilities-*` |
| 6 | **/jobs/** | 130 / 1 | SectionHero, SectionRule, mono-tabeller (144-277 monoelement) | `*-jobs-*` |
| 7 | **/whats-on/** | 106 / 1 | MarqueeCard, WhatsOnCard, SectionRule; AI-intro kvar i koden (`whats_on_intro`) | `*-whatson-*` |
| 8 | **/events/free/, /events/kids/ ... (facetsidor)** | 71 / 1 | StoryCard-lista, SectionRule (ej på dagsgruppering) | `*-eventsfree-*` |
| 9 | **/closures/** | - | PageGuide, SectionHero; svaret ("No closures announced") på y ~1280 | `*-closures-*` |
| 10 | **/this-weekend/** | 7 / 0 | components/evening/* (äldre kortsystem), SectionHero | `*-thisweekend-*` |
| 11 | **/this-week/ och /this-week/YYYY-wNN/** | 4-10 / 1 | arkivsidor med AI-ingress; beslut 3: ska 301:as till /this-week/ (Fas 5) | `*-thisweek-*` |
| 12 | /workplace-watch/, /vail-resorts/ (Broomfield) | 24 / 1, 77 / 0 | egen markup | - |
| 13 | /s/[slug] (berättelsesidan) | 1-15 per sida | WeekGroupList, AI-text (5 referenser) | - |
| 14 | /sports/, /jackrabbits/, /university/, /game-day/ (Brookings, delvis Moreno) | - | SectionHero, SectionRule, StoryCard | - |
| 15 | /home-sales/, /trash-recycling/, /farm-report/, /traffic-liknande referenssidor | - | SectionRule; /home-sales/ har AI-referens | - |
| 16 | Statiska sidor (about, privacy, terms, ...) | - | ren text; behöver bara AboutThisPage-mönstret, ingen hjälte | - |

## Moduler på startsidan som är gamla (per modul, alla fyra städer om inget annat sägs)
| Modul | Läge efter detta steg |
|---|---|
| Today / This week / Coming up (StoryCard-floder) | **Ersatta** av EventsGlance + EventDayList (samma komponenter som /events/) |
| This weekend (WeekendModule) | **Ersatt** av EventDayList (helgdagarna) |
| Worth knowing (StoryCard + AI-text) | **Ersatt** av MeetingLine (datarader från Fas 3) |
| WeeklyRoundup (AI-veckoingress) | **Borttagen** från startsidan (beslut 5: veckoingresserna raderas) |
| TopEventCard / MarqueeCard (Ticketmaster-marquee) | kvar, gammalt kortsystem; kandidat för nästa omgång |
| LeadStory / SecondaryStory | kvar, gammalt kortsystem; innehåller berättelser som kan vara AI-skrivna (källa `generated_by`) |
| Rail: Tile-väder, GameCard, Trafik, Markets | kvar, gamla; väder-Tile bör bli HeroStat med temperaturen |
| OrientationHeader, CityStatus, QuickLinks | kvar, gamla men fungerar som statusremsa; CityStatus är "Right now"-rutan |
| "More from <stad>" paneler | kvar, gamla (panel-kort) |

## Skillnader per stad som påverkar bygget
- **Broomfield** har 0 kommande event i databasen (`stories` source_type=event, inga kalenderscrapers). /events/ och startsidans eventblock visar därför det designade tomma läget. Sidan kan inte visas fylld utan data (se `.claude/` Broomfield-utredningen).
- **Moreno** har flest rader (51 kommande) men saknar OSM-områden (egna 9 areas finns); stor andel serier (35 av 51).
- **Glasgow** har strukturerad `meta.cost` ("Free …") på 21 av 27; `meta.tags` "Kids & families" på 6.
- **Brookings** har SDSU-feeden (sdsu_events) och därmed dubbletter över källor (se dedup-fallet Concert Choir 6 nov).
