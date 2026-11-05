# standards.md: designsystem och standardlayouter

Gäller alla fyra sajter. Källa: ägarens handoff 2026-11-05 (.claude/specs/premium-presentation.md) och besluten i .claude/specs/premium-decisions.md. Städer skiljer sig bara i config (data, tidszon, enheter, US/UK-stavning, accentfärg, organ- och områdesmappningar), aldrig i layoutkod.

## Hårda regler
- Ingen AI-prosa. All text är källdata eller mallsträngar byggda av datafält, med tester.
- Inget utan data. Ingen siffra, badge, insikt, chip eller ikon visas om datan saknas. Gissa aldrig.
- Svaret först. Det besökaren söker syns utan scroll i 390 px. Förklaringar, källor och disclaimers samlas under "About this page" längst ner (ersätter PageGuide överst, beslut 2026-11-05). Enda undantaget är aktiva varningar: banner överst.
- Title-taggar ändras inte utan ägarens ja. H1 får kortas.
- Inga hotlinkade bilder, ingen extern JS utöver det som redan används.
- Inga arbetsgivarnamn eller referenser utanför projektet i kod, commits eller docs.

## Del A: designprinciperna (ordagrant)

1. **En hjälte per vy.** Varje sida och sektion har ETT dominerande element: nu-temperaturen, nästa möte, "in 26 min". Det är 2-3x större än allt annat. Resten underordnas.
2. **Tre nivåer, inte fler.** Hjälte, primär (titel/värde) och meta. Storlek, vikt och färg skiljer dem. Om allt är lika viktigt är inget viktigt.
3. **Visualisera mönster, lista inte.** Spann blir range-bars, förlopp tidslinjer eller sparklines, andelar mätare. En rad med siffror är sista utvägen.
4. **Slå ihop upprepning.** Samma värde flera gånger i rad visas en gång ("Cloudy all week", "Every Tuesday"). Upprepade etiketter blir rubriker.
5. **Insiktsrader från data.** Korta mallsträngar som svarar på frågan bakom frågan: "Dry until 3pm", "Next: City Council in 5 days", "3 free things tonight". Varje mall har regel, tröskel och test, och visas bara när regeln slår.
6. **Färg med betydelse.** Accent för det viktigaste och "nu". Kategorifärger (max 6, dämpade, AA-kontrast) för typ. Temperaturskala för temperatur. Aldrig dekorativ färg.
7. **Djup med ytor, inte ramar.** Upphöjda ytor (bakgrundston) och hårlinjer på 1 px / 10 %. Inga boxar med kantlinjer runt allt.
8. **Typografi.** Serif för rubriker och titlar. Sans med `tabular-nums` för all data och meta. Monospace används inte för data. 8 px-grid, mer luft mellan grupper än mellan rader.
9. **Ikoner.** Ett eget inline-SVG-set med samma linjetjocklek (väder, kategorier, organ, åtgärder). Alltid med text eller aria-label.
10. **Rytm.** Växla mellan swipe-rader, kort och kompakta listor så att sidan inte blir en vägg. Max ~7 objekt innan "See all" fäller ut resten.
11. **Progressiv visning.** Kärnan syns direkt, detaljer bakom tryck (`<details>` där det går). Ingen informationsförlust för sökmotorer, allt finns i HTML:en.
12. **Färskhet synlig.** "Updated 10:00" i en diskret metarad nära toppen, från datan (`fetched_at`, beslut 2026-11-05; `issued` får följa med men visas inte).
13. **Rörelse sparsamt.** Mjuka övergångar vid filtrering och utfällning. Inget blinkande, allt av under `prefers-reduced-motion`.
14. **Tomma lägen är design.** Varje komponent har ett genomtänkt tomt läge (en rad + vart man går i stället). Aldrig en rubrik utan innehåll, aldrig "0 things".
15. **Prestanda är premium.** Ingen layoutförskjutning, mål LCP < 2,5 s i mobil, inga onödiga beroenden.

## Typsnitt (mätt 2026-11-05)
Bricolage Grotesque (Google Fonts-bygget) har OpenType-featuren `tnum` (och `pnum`); standardsiffrorna är proportionella (advance 320-656), så `font-variant-numeric: tabular-nums` behövs och fungerar. Ingen ny sans behövs. Data och meta: `--font-ui` + tabular-nums. `--font-data` (Plex Mono) används inte längre i datarader. Rubriker: Newsreader.

## Komponentbiblioteket (site/src/components/ui/)
HeroStat, InsightLine, RangeBar, HourStrip (timmar med temperaturkurva + regnstaplar), DayRows (en rad per dag, detaljer bakom tryck), TimeStrip, Card (toppkant 4 px i kategorifärg), CompactRow (vänsterkant 3 px), Chips (>=3 per chip, >=2 chips, inga siffror), DayStrip, Pill/Badge, SectionHeader, WarningBanner, EmptyState, AboutThisPage, FallbackTile, Icon. Tokens i site/src/design/ui-tokens.css; accent från site.config. Galleri: `/_design/` (pages/[design].astro, noindex, ej i sitemap, bara byggt med BUILD_DESIGN=1).

Regel: ingen sida skriver egen CSS för något biblioteket redan har. Städer får inte ha kodvägar i layouten (`townId ===`, stadsnamn, `country ===`); skillnader ligger i config. Test: lib/ui/standard-layout.test.ts.

## Standardlayouter
Format per layout: syfte (frågan den besvarar), komponent, config-fält, tomma lägen, tester.

### Navigation
- Syfte: "Vart tar jag mig för att göra X?" Sektionsraden visar de viktigaste sektionerna, sheet "All" resten.
- Komponent: SectionNav.astro + lib/nav-sections.ts (SECTIONS, resolveNav, enabledSections).
- Config: hasWhatsOn, hasClosureWatch, hasNewInTown, hasWorkplaceWatch, disabledSections, quietSections, navLabels, eveningLayer, safetyNotices (NavGate i nav-sections.ts). Per-stads-gates får finnas här och bara här.
- Tomt läge: en avstängd sektion finns inte i navet och inte i sitemap; ingen länk till en tom sida.
- Tester: nav-sections-testerna; sitemap/noindex-disjoint.

### Helgsidor (Thanksgiving, Veterans Day, Christmas, ...)
- Syfte: "Vad är stängt/öppet, och vad händer, på <helg> här?"
- Komponent: HolidayPage.astro + lib/holiday-page.ts; data i config/holiday-pages/*.ts.
- Modell: HolidayFact = confirmed | unconfirmed (unconfirmed kräver lastYear eller checkAt); HolidayEvent; linkOnly för robots-spärrade källor (visas som länk, hämtas aldrig, CLAUDE.md #13); Event-JSON-LD bara för confirmed; vanliga öppettider under "More" (section hours), aldrig i closures.
- Config: locale (en-US/en-GB), metaOverride (fast godkänd text), fönsterregel (~6 veckor före första bekräftade event till sista dagen).
- Tomt läge: sektion utan bekräftad rad nämns inte i title/H1; unconfirmed-rader visar checkAt.
- Tester: lib/holiday-page.test.ts, lib/christmas.test.ts, veterans-day.

### Tonight
- Syfte: "Vad händer ikväll, och vad är öppet sent?"
- Komponent: components/tonight/{TonightCard,TonightRows,TonightChips,TonightStyles}.astro + lib/tonight-cards.ts (+ -client.ts). Bygger om på ui/* i Fas 1 och ska se likadan ut.
- Hjälte: `heroFor` ("in 26 min" / Starting soon). Insiktsrad: header per `dayView`. Chips: `chipPlan` (CHIP_MIN_*). Badges: `badgesFor`, bara stated data.
- Config: eveningLayer.cards (regions, maxChips, hidePrice, cityLabels), venue-register, osm_places.
- Tomt läge: `dayView` (inget kvar -> rubrik + rader dolda, "Nothing else on tonight · Tomorrow: N things"); aldrig "0 things".
- Tester: lib/tonight-cards.test.ts (48), qa-probe .tc-day/.tc-card.

### Weather
- Syfte: "Hur är vädret nu, vad gör det idag, vad ska jag planera för veckan?"
- Komponent: pages/weather.astro på ui/* (WarningBanner, HeroStat, InsightLine, HourStrip, DayRows, SectionHeader, AboutThisPage). Svarsblocket (hjälte -> insikter -> 24 h -> vecka) är strängmarkup från lib/weather-html.ts; webbläsaren ritar om det med samma funktion (lib/live-weather.ts) när /api/weather ger nyare data.
- Ordning: varning (bara aktiv) -> H1 "<stad> weather" + "Källa · Updated <tid>" -> hjälte (prognosen för aktuell timme, märkt "Forecast for 2pm"; känns som bara om ≥2° skillnad; dagens hög/låg) -> insiktsrader -> Next 24 hours -> Week ahead (rad per dygn, dag+natt ihopslagna, RangeBar på veckans gemensamma skala) -> "Cloudy all week" ovanför veckan -> About this page.
- Insiktsregler (lib/weather-model.ts, trösklar som exporterade konstanter): regn/torrt ur nederbördssannolikhet >=50 % (annars källans ord, utan "chance"), "Dry until" om <6 h annars "Rain from", "Dry for the next N hours" kräver >=12 h data; "Warmer/Colder tomorrow" och "than yesterday" vid högst-skillnad >=2 °C / 4 °F; "<Väder> all week" = samma väderklass >=3 dygn (all week bara vid >=5 dygn); gårdagens värde är gårdagens lagrade prognos (prognos mot prognos).
- Config: temperaturenhet (country profile), koordinater (townCenter) för sol-tider, auktoritet och officiell varningslänk (country profile `weather`), hasMetOfficeWarnings, hasHeatAdvisory. Payload: valfria pop/feels/gust/uv/precip_mm + fetched_at; saknas de visas de inte.
- Tomt läge: ingen prognos -> EmptyState med länk till källan; ingen timdata -> hjälten faller tillbaka på dagens hög/låg, ingen 24 h-remsa, ingen regnrad.
- Tester: lib/weather-model.test.ts, sun-times.test.ts, ui/ui-html.test.ts, live-weather.test.ts (riktig Chromium), cron-dispatcher/test/weather.test.ts + tests/test_noaa_payload.py (TS<->Python-paritet).

### Meetings
- Syfte: "När är nästa möte, vad står på dagordningen och hur tar jag mig dit?"
- Komponent: components/meetings/{MeetingCard,MeetingsUpcoming,ArchivePage}.astro + lib/meetings-view.ts; .ics via pages/city-hall/calendar/[id].ics.ts.
- Hjälte: nästa möte ("Next up"). Datarader: datum, tid, organ, plats, dagordningspunkter ordagrant från källan, länk till agenda/protokoll, .ics. Ingen AI-text (beslut 2026-11-05).
- Config: MEETINGS_TOWNS och BODIES per stad (flyttas till per-stad-config i Fas 3; Glasgow: Area Partnerships i utfällbar grupp).
- Regler: dedup = samma datum + normaliserat organ, Legistar behålls; tidskonflikt mellan källor visar "Time: see agenda"; quorum-notiser är inte möten; Event-JSON-LD och .ics bara med start+plats.
- Tomt läge: inga kommande möten -> en rad + länk till arkiv/källa.
- Tester: lib/meetings-view.test.ts (26+).

## Rapport per fas
Ändrade filer, skärmdumpar 390 px och 1280 px (mörkt/ljust, före/efter), osäkerheter, nästa steg. Stanna och vänta på ägarens OK efter varje fas.
