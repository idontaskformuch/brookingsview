# standards.md: designsystem och standardlayouter

Gäller alla fyra sajter. Källa: ägarens handoff 2026-11-05 (.claude/specs/premium-presentation.md) och besluten i .claude/specs/premium-decisions.md. Städer skiljer sig bara i config (data, tidszon, enheter, US/UK-stavning, accentfärg, organ- och områdesmappningar), aldrig i layoutkod.

## Hårda regler
- Ingen AI-prosa. All text är källdata eller mallsträngar byggda av datafält, med tester.
- Inget utan data. Ingen siffra, badge, insikt, chip eller ikon visas om datan saknas. Gissa aldrig.
- Inga kommentarer (`{/* */}`, `/* */`) inne i Astro-mallar: två gånger 2026-11-25 tog en sådan bort all komponent-CSS i ett grönt bygge. Kommentarer i frontmatter. scripts/verify_astro_template_comments.mjs fäller batteriet på orsaken (QA build.astro-template-comment); scripts/verify_page_css.mjs stoppar resultatet i batteriet och i varje deploy (scripts/wrangler_deploy_retry.sh).
- Tidsberoende ord räknas i webbläsaren (SPEC Fas 3, 2026-11-25). "today/tomorrow/in N days/N days away" och "Today" skrivs av lib/client/time-status.ts från `data-rel-day="YYYY-MM-DD"` (stil in/away/day, `data-rel-prefix`) i stadens zon, vid laddning och varje minut; utan JS står datumet ensamt (elementet är tomt och `hidden`). /events/-översiktens "N things on today · N tonight · N free" räknas av lib/client/events-glance.ts och visas inte utan JS. Öppet/stängt: facilities-skripten och lib/client/open-tonight-list.ts. Ingen komponent skriver relativa ord vid build (lib/client/time-status.test.ts).
- Inga tomlägestexter (ägaren 2026-11-24, alla städer). En tom sektion döljs helt, rubriken också; sidan leder med det som finns. Ingen `class="empty"`/`__empty`, inga "No X yet"/"A quiet week"/"check back". Bygget fäller dem (scripts/verify_no_empty_messages.mjs, QA build.empty-state). Undantag: filtrets "Nothing matched" i klientsidans tabeller (svar på besökarens eget filter, aldrig i byggd HTML).
- Svaret först. Det besökaren söker syns utan scroll i 390 px. Förklaringar, källor och disclaimers samlas under "About this page" längst ner (ersätter PageGuide överst, beslut 2026-11-05). Enda undantaget är aktiva varningar: banner överst.
- Title-taggar ändras inte utan ägarens ja. H1 får kortas.
- Inga hotlinkade bilder, ingen extern JS utöver det som redan används.
- Inga arbetsgivarnamn eller referenser utanför projektet i kod, commits eller docs.

## Del A: designprinciperna (ordagrant)

1. **En tydlig fokuspunkt per vy, i form av en statusmening i rubrikstorlek. Display-siffror bara när värdet självt är svaret och är ett mått.** (Ägarbeslut 2026-11-20; ersätter "En hjälte per vy". HeroStat används bara för temperatur, matchresultat och pris. Accentfärg/rött bara för varningar.)
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

## Sidgrid och typografiminimum (ägarbeslut 2026-11-20, designsystem Fas 1)
- Ett skal, en vänsterkant på alla sidor. RailLayout (huvudspalt + sidospalt) är standard; brytpunkt 62rem (992px) överallt. Under brytpunkten hamnar sidospalten under huvudinnehållet (kontroll vid 375px).
- Metadata och tickern: minst 13px. Inga undantag.
- Tillåtet mönster (ägarbeslut 2026-11-20): "Hero-band i fullbredd ovanför griden, för bildtunga sidor". Sidans rubrik och bildkorten ligger i `slot="band"` (BaseLayout, hela skalet 74rem, tre kolumner); resten av sidan ligger i griden under (huvudspalt 44rem + sidospalt). Referens: What's On (marquee i bandet, "Also on" i huvudspalten).
- Eventlistor (Fas 1, 2026-11-20): EventRow (tid till vänster, titel, plats; kategori bara när listan blandar), EventCard (bildkort), DayGroup (datum en gång per dag). Raddata byggs bara i lib/event-row.ts. Ticketmaster-dag och -tid tas ur localDate/localTime, aldrig omräknat från UTC.

## Komponentbiblioteket (site/src/components/ui/)
HeroStat (bara temperatur, matchresultat, pris), EventRow, EventCard, DayGroup, InsightLine, RangeBar, HourStrip (timmar med temperaturkurva + regnstaplar), DayRows (en rad per dag, detaljer bakom tryck), TimeStrip, Card (toppkant 4 px i kategorifärg), CompactRow (vänsterkant 3 px), Chips (>=3 per chip, >=2 chips, inga siffror), DayStrip, Pill/Badge, SectionHeader, WarningBanner, EmptyState, AboutThisPage, FallbackTile, Icon. Tokens i site/src/design/ui-tokens.css; accent från site.config. Galleri: `/_design/` (pages/[design].astro, noindex, ej i sitemap, bara byggt med BUILD_DESIGN=1).

## Mönster för helg- och dagsidor (ägarbeslut 2026-11-26, designlyften; pilot: julsidan, variant B)
Principer (ordagrant i specs/design-lift-holiday-2026-11-26.md): storlek efter vikt (en hero per sida, den svarar på det besökaren kom för); text till struktur (matriser, chips, ikoner, inte meningar); sammanfatta före detaljerna (digest-rad); bryt rytmen (max ca 5 likadana kort i rad, sedan annan modultyp); ett utvalt, resten kompakt; metadata ("Checked …") längst ner, liten. Tider "12:00"/"Noon", aldrig "PM" plus jättesiffra.
Komponenter i site/src/components/holiday/, data som rena funktioner i lib/holiday-festive.ts. Galleri: sektionen "Holiday patterns" på `/_design/` (stadens egna julrader).
- **Matris** (HolidayMatrix, `holidayMatrix`): ställen som rader, nyckeldagar som kolumner (+ varje annan dag ett ställe ändrar). Cell = "Closed"/källans eget ord (markerad, ikon), en tid, eller "Normal". Max `MAX_CELL` = 15 tecken; längre källtext blir "Early finish" (källan säger uttryckligen att något slutar/stänger tidigare, `earlyFinish`), annars "Changed" (riktningen framgår inte) eller "Closed", + numrerad fotnot under matrisen, samma text = samma nummer (`footnoteCells`). Riktig `<table>`, sticky första kolumn, sidscroll på mobil. Används när frågan är "vad är öppet vilken dag" och det finns >= 2 ställen eller >= 2 dagar.
- **Digest-rad** (`digestLine`): inleder varje dag/grupp: "3 events · St Enoch closed · No trains". Bara delar som har data; högst 3 stängningar, sedan "+N more closed".
- **Utvalt + kompakt** (FestiveDay, `dayBlocks`/`featuredOf`): datumbricka, digest, ETT utvalt kort (serien med färst dagar, tidigast vid lika), sedan högst 5 täta rader och "N more" bakom tryck. En serie (samma titel + plats) = en rad per dag med alla tider. Utvalt vänster / rader höger från 62rem.
- **Adventsremsa** (AdventStrip, `adventStrip`): en ruta per dag i intervallet, prick per evenemang (max 3), ikon för stängt/inga tåg, tryck -> dagen. Kompakt, sticky ovanför dagblocken, sidscroll på mobil. **Tomlägesregel:** döljs helt om färre än `MIN_STRIP_EVENT_DAYS` = 3 dagar i intervallet har evenemang (Broomfield nov 2026).
- **Säsongstema** (config/holiday-themes.ts, `themeStyle`): två färger per helg (ink + warm, ljus och mörk), bara på linjer, datumbrickor och små ornament vid rubrikerna. Inga snöflingor, glitter eller animationer. Jul = gran + guld, Thanksgiving = rost + skördeguld; helg utan post behåller sajtens accent. AA-test i lib/holiday-festive.test.ts.
- **Rytmbrott:** flerdagarsevenemang som karusell (`seasonRuns`); övriga veckor med digest (`weekGroups`).
- Tester: lib/holiday-festive.test.ts (riktiga julsidedata från config), holiday-season.test.ts (serier/panto).
- **Utrullning a (2026-11-26, order 26 nov (7)): /events/ och /this-week/** via delade komponenter, alla städer: components/events/EventDays.astro
  = DayGroup (rubrik + digest-rad, prop `digest`) + ui/EventFeature (ett utvalt kort) + EventRow (max `MAX_COMPACT` = 5, resten bakom "N more").
  Regler i lib/day-digest.ts: digest = antal · två vanligaste kategorierna (bara när dagen blandar) · antal "Free"; ingen digest för en dag
  med en rad. Utvalt = stadens toppevenemang (siteConfig.topEvents) > första engångshändelse med länk > första period (run) med länk;
  aldrig något återkommande (extra "Weekly/Regular/…" eller `recurring` från källan); ingen ruta för en dag med en rad.
  /this-week/ (lib/week-groups.ts weekDayBlocks): samma dagblock; det som går >= `ALL_WEEK_DAYS` = 3 dagar blir ett kort var i
  karusellen "All week" (ui/RunCarousel.astro) i stället för en rad per dag. Temagrupperna (groupWeekItems) används bara av
  universitetsdigesten. Tester: lib/day-digest.test.ts, week-groups.test.ts (riktiga Glasgow-rader 2026-11-26).
- **Ticketmaster i evenemangsflödet (order 26 nov (8)):** FeedItem har tre sorter (story, arts, ticketmaster). /events/ och /this-week/
  tar Ticketmaster-raderna genom samma dedupe (event-dedup.mjs, egen sida vinner), samma Nearby-regel (events.ts ticketmasterLocality:
  platsens stad avgör; annan stad inom 25 mi = nearby; längre bort = 'outside', aldrig med) och samma kategori. Sport bara där
  `eveningLayer.includeTicketmasterSports`. **I listor, aldrig i räknare** (ägaren 26 nov): event-day-view isOwnEvent styr dagsremsan,
  "N things on today", tonight/free, sidhuvudets och startsidans räknare; veckans noindex-räkning (week-count.mjs) läser aldrig
  Ticketmaster. På /events/ visas Ticketmaster bara inom sidans egna 7 dagar (DAY_WINDOW); senare = länk till What's On.
- **Nearby tar aldrig över en dag (order 26 nov (9)):** per dag stadens egna rader först; Nearby (Ticketmaster och egna evenemang i
  annan stad) i ett eget avgränsat block sist, rubrik "Nearby · Denver, Boulder, Arvada…", max `NEARBY_PER_DAY` = 3 (egna före
  biljettlistningar); resten: egna bakom "N more nearby", biljetter bakom "More nearby shows →" till What's On. Utvalt kort bara från
  staden; en dag utan något i staden har inget. Digest räknar separat: "4 events · +12 nearby". /events/ har ingen egen Nearby-sektion
  längre. Kod: lib/day-digest.ts splitNearby, EventRowData.nearby, DayGroupData.nearby, week-groups weekDayBlocks (karusellen "All week"
  tar bara stadens egna).
- **Utrullning b (order 26 nov (10)): /today/ och /tonight/** samma dagblock. /today/: varje bucket (Today/Tonight/Tomorrow) planeras av
  lib/today-buckets.ts planBucket (samma plan på servern och i webbläsaren): digest i DayGroup-raden, utvalt (mall #today-event-features),
  max 5 stadsrader, Nearby-block; Ticketmaster via buildTownEntries (ersätter Glasgows "max 3 shower", lib/today-shows.ts används inte);
  "Coming up" bara stadens egna. /tonight/: TonightRows = digest, utvalt (ul/li data-card + live-etikett), PopEventList max 5 + "N more",
  Nearby-block (lib/evening-rows.ts eveningRow/isNearbyEntry); "Up next"-listan borttagen (dubblerade kvällens rader). Nearby-blockets
  stil global i DayGroup (.nearby-block). Rader i blocket säger orten en gång (day-digest withoutNearbyWord).
- **Kvällsgrupperna** (evening-items eveningGroup): categorize först, sedan delas kategorin i kvällsgrupper (music -> Live music/Clubs &
  late, nightlife -> Quiz/Clubs/Live music/Comedy & shows, arts -> Film/Theatre/Comedy & shows; food/civic/utställning: ingen grupp).
  Ticketmaster: segment före genre överallt ("Dance/Electronic" under Music = music).
- **En kategorifunktion** (lib/event-category.ts categorize): källans etikett (TM: genre, sedan segment), sedan titeln, platsen sist.
  Alla sidor (event-row-facts, week-groups themeOf/dagblock, big-shows) går genom den.

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
- Komponent: HolidayPage.astro + lib/holiday-page.ts; data i config/holiday-pages/*.ts. Julen i alla städer (def `layout: 'festive'`): holiday/HolidayFestivePage.astro, ordning matris -> insikter -> adventsremsa -> dagblock -> karusell -> veckor -> support/kolla innan/länkar -> "Checked" (se Mönster ovan). HolidaySeasonPage borttagen 2026-11-26.
- Modell: HolidayFact = confirmed | unconfirmed (unconfirmed kräver lastYear eller checkAt); HolidayEvent; linkOnly för robots-spärrade källor (visas som länk, hämtas aldrig, CLAUDE.md #13); Event-JSON-LD bara för confirmed; vanliga öppettider under "More" (section hours), aldrig i closures.
- Config: locale (en-US/en-GB), metaOverride (fast godkänd text), fönsterregel (~6 veckor före första bekräftade event till sista dagen).
- Tomt läge: sektion utan bekräftad rad nämns inte i title/H1; unconfirmed-rader visar checkAt.
- Tester: lib/holiday-page.test.ts, lib/christmas.test.ts, veterans-day, lib/holiday-festive.test.ts.

### Tonight
- Syfte: "Vad händer ikväll, och vad är öppet sent?"
- Komponent: components/tonight/{TonightCard,TonightRows,TonightChips,TonightStyles}.astro + lib/tonight-cards.ts (+ -client.ts). Bygger om på ui/* i Fas 1 och ska se likadan ut.
- Hjälte: `heroFor` ("in 26 min" / Starting soon). Insiktsrad: header per `dayView`. Chips: `chipPlan` (CHIP_MIN_*). Badges: `badgesFor`, bara stated data.
- Config: eveningLayer.cards (regions, maxChips, hidePrice, cityLabels), venue-register, osm_places.
- Tomt läge: `dayView` (inget kvar -> rubrik + rader dolda, hjälten leder med det som finns: "N places open late" eller länken "Tomorrow: N things", annars ingen rad); aldrig "0 things", aldrig "Nothing else on tonight".
- Tester: lib/tonight-cards.test.ts (48), qa-probe .tc-day/.tc-card.

### Weather
- Syfte: "Hur är vädret nu, vad gör det idag, vad ska jag planera för veckan?"
- Komponent: pages/weather.astro på ui/* (WarningBanner, HeroStat, InsightLine, HourStrip, DayRows, SectionHeader, AboutThisPage). Svarsblocket (hjälte -> insikter -> 24 h -> vecka) är strängmarkup från lib/weather-html.ts; webbläsaren ritar om det med samma funktion (lib/live-weather.ts) när /api/weather ger nyare data.
- Ordning: varning (bara aktiv) -> H1 "<stad> weather" + "Källa · Updated <tid>" -> hjälte (aktuell timmes temperatur, vald i webbläsaren ur timdatan; dagens hög/låg och väderläge; känns som bara om ≥2° skillnad. Fallback utan JS: dagens hög/låg, aldrig en specifik timme. Etiketten "Forecast for 2pm" krävs inte längre, ägarbeslut 2026-11-20) -> insiktsrader -> Next 24 hours -> Week ahead (rad per dygn, dag+natt ihopslagna, RangeBar på veckans gemensamma skala) -> "Cloudy all week" ovanför veckan -> About this page.
- Insiktsregler (lib/weather-model.ts, trösklar som exporterade konstanter): regn/torrt ur nederbördssannolikhet >=50 % (annars källans ord, utan "chance"), "Dry until" om <6 h annars "Rain from", "Dry for the next N hours" kräver >=12 h data; "Warmer/Colder tomorrow" och "than yesterday" vid högst-skillnad >=2 °C / 4 °F; "<Väder> all week" = samma väderklass >=3 dygn (all week bara vid >=5 dygn); gårdagens värde är gårdagens lagrade prognos (prognos mot prognos).
- Config: temperaturenhet (country profile), koordinater (townCenter) för sol-tider, auktoritet och officiell varningslänk (country profile `weather`), hasMetOfficeWarnings, hasHeatAdvisory. Payload: valfria pop/feels/gust/uv/precip_mm + fetched_at; saknas de visas de inte.
- Tomt läge: ingen prognos -> prognosytan renderas inte (ingen tomtext, ägaren 2026-11-24; källänken står redan i rubrikraden); ingen timdata -> hjälten faller tillbaka på dagens hög/låg, ingen 24 h-remsa, ingen regnrad.
- Tester: lib/weather-model.test.ts, sun-times.test.ts, ui/ui-html.test.ts, live-weather.test.ts (riktig Chromium), cron-dispatcher/test/weather.test.ts + tests/test_noaa_payload.py (TS<->Python-paritet).

### Meetings
- Syfte: "När är nästa möte, vad står på dagordningen och hur tar jag mig dit?"
- Komponent: components/meetings/{MeetingCard,MeetingsUpcoming,ArchivePage}.astro + lib/meetings-view.ts; .ics via pages/city-hall/calendar/[id].ics.ts.
- Fokus: nästa möte ("Next up") som ett vanligt MeetingCard (organ, rubrik med datum · tid, "in N days" från webbläsaren · plats), ingen stor siffra (ägaren 2026-11-25, Tillägg A). Datarader: datum, tid, organ, plats, dagordningspunkter ordagrant från källan, länk till agenda/protokoll, .ics. Ingen AI-text (beslut 2026-11-05).
- Config: MEETINGS_TOWNS och BODIES per stad (flyttas till per-stad-config i Fas 3; Glasgow: Area Partnerships i utfällbar grupp).
- Regler: dedup = samma datum + normaliserat organ, Legistar behålls; tidskonflikt mellan källor visar "Time: see agenda"; quorum-notiser är inte möten; Event-JSON-LD och .ics bara med start+plats.
- Tomt läge: inga kommande möten -> hela "Next up"-blocket utelämnas (ägaren 2026-11-24); Recent meetings och arkivlänken står kvar.
- Tester: lib/meetings-view.test.ts (26+).

## Rapport per fas
Ändrade filer, skärmdumpar 390 px och 1280 px (mörkt/ljust, före/efter), osäkerheter, nästa steg. Stanna och vänta på ägarens OK efter varje fas.
