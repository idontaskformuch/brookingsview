# Premium-presentation, Fas 0: inventering (2026-11-05)

Spec: .claude/specs/premium-presentation.md. Inga ändringar i kod, config eller DB. Allt nedan är läst ur koden, DB (bara SELECT) eller uppmätt.

## Metod (så att siffrorna kan omprövas)
- HEAD 7e2dc13 byggd för alla fyra städer (Brookings = befintlig `site/dist`, de tre andra till egna utmappar i scratchpad). Sidorna serverade lokalt och mätta i headless Edge, 390 x 844, ljust och mörkt.
- "Svaret" = y-position (px från sidans topp) för det första element som innehåller det besökaren söker. "Chrome" = höjd tills första innehåll.
- Externa hosts blockerades (samtycke = declined), så Googles typsnitt laddades inte: fallback-typsnitt, pixlar är +-5 %. Mono-/ruteräkningar är antal synliga löv-element i `main`.
- Trafikdata saknas (GA4-export finns bara för Broomfield, .claude/gsc/); ordningen nedan är därför min gissning av sökintresse, som handoffen anger.

## 1. Huvudfynd
1. **Chrome tar 248-310 px av 844** (29-37 %) innan innehållet börjar: logga, datumrad, nav, skylt (sign strip med 1-3 rader). Brookings 310, Moreno 301-335, Broomfield 248-282, Glasgow 248. Dessutom en sektionsbild på ca 290 px på /events/, /today/, /traffic/, /closures/, /city-hall/, /jobs/ (H1 hamnar på y 549-612 i stället för 282-344).
2. **PageGuide ("What this shows / How to use it / Sources") ligger överst på nästan alla sidor** (3 stycken, ca 300 px). Den är CLAUDE.md-regeln "data -> vad betyder det -> vad kan läsaren göra" från 2026-10-22. Handoffen flyttar den till `AboutThisPage` längst ner: samma text, ny plats. Behöver ditt uttryckliga ok eftersom den äldre regeln placerade den först.
3. **Väder, den mest sökta sidan, visar ingen temperatur utan scroll.** Första prognossiffran ligger på y 904-974 (under 844-vikningen), efter H1, ingress, PageGuide och flood-länk. Ingen "nu"-temperatur, inga ikoner, ingen insikt, ingen tidsstämpel.
4. **Svaret ligger långt ned på frågesidorna:** /closures/ "No closures announced." på y 1280-1329; /today/ H1 på y 854-1033; /events/ första dagen på y 1462-1522.
5. **Tre sidor bär AI-text som sidans ledtext:** /whats-on/ (Brookings: "AI-generated from this week's listed events", y 752-1059), /this-week/YYYY-wNN/ (Brookings: AI-ingress y 448), /city-hall/ för Glasgow, Moreno och Broomfield (alla `meeting`-stories är `ai:claude-*`). Handoffens regel "ingen AI-prosa" slår här; se beslutspunkt 5.
6. **Monospace som datatypsnitt är utbrett:** `.data` + `--font-data` (IBM Plex Mono) i 31 filer; 74-76 mono-element på väder, 60-101 på /events/, 144-277 på /jobs/, /whats-on/, /sports/. Handoffen förbjuder detta.
7. **Ramar runt allt:** 50-96 helt inramade element på /events/ (390 px). Bara Tonight-korten har ytor + toppkant.
8. **Ingen ikonuppsättning:** 8 inline-SVG i hela komponentträdet (dela, nav, 1 widget). Väder har inga ikoner; ett par sidor använder emoji (🏛️ i StoryCard, 📦 på väder).
9. **Rörelse:** `prefers-reduced-motion` hanteras i 4 filer (BaseLayout, SectionNav, TonightStyles + 1), `tabular-nums` i 11.
10. **Befintliga defekter som mätningen visade (inget fixat, Fas 0 är läsning):** horisontell scroll i 390 px på Moreno /sports/ och Brookings /trash-recycling/ (uppmätt med fallback-typsnitt, bör dubbelkollas); Moreno /home-sales/ visar "0 most recent, through ..." (strider mot princip 14). Båda bör få QA-kontroll + fixtur enligt CLAUDE.md regel 12 när de åtgärdas.

## 2. Sidtyper per sajt (komponent, källa, täckning)
Sektionerna kommer från `lib/nav-sections.ts` (SECTIONS) och bekräftades mot byggda nav-länkar.

| Sidtyp | Fil / komponent | Datakälla och fält | B | M | Bf | G | Indexering |
|---|---|---|---|---|---|---|---|
| Start | pages/index.astro (862 r) | stories, events, weather, meetings, alerts | x | x | x | x | index |
| Weather | pages/weather.astro + live-weather.ts | weather_snapshots.payload (periods 14, hourly 24: temp, unit, short, wind-text, is_daytime) + alerts | x | x | x | x | index |
| Today | pages/today.astro + TodayBlock (396 r) + SectionHero | events, TM, weather-rad, alerts | x | x | x | x | index |
| Tonight | pages/tonight.astro + components/tonight/* + lib/tonight-cards.ts | eget events, Ticketmaster, evening_register, osm_places | noindex (never) | noindex (verdikt) | index | index | evening-verdict |
| This weekend | pages/this-weekend.astro + components/evening/* (äldre kort) | samma som Tonight | noindex | noindex | index | index | verdikt |
| Events | pages/events.astro (458 r) + EventBucket | stories(event), events, TM, facilities | x | x | noindex | x | index utom Bf |
| Events/[facet], past | pages/events/* | event-facets | x | x | x | x | - |
| This week | pages/this-week/[week].astro + week-groups.ts | stories + events, AI-ingress | x | x | noindex | x | 8 senaste veckorna |
| What's On | pages/whats-on/* + WhatsOnCard/MarqueeCard | Ticketmaster, AI-intro (getWhatsOnIntro) | x | x | x | x | index |
| City hall / Meetings | pages/city-hall.astro + components/meetings/* + lib/meetings-view.ts | meetings (body, meeting_date, agenda_url, raw_data) + stories | **ny layout** | gammal | gammal | gammal | index |
| Facilities | pages/facilities/* + facility-hours/lede | facilities-tabellen, OSM-tider | 41 | 64 | 47 | 13 | index (tunna noindex) |
| Closure Watch | pages/closures.astro | skolor + NWS-alerts | x | x | borta | borta | index |
| Traffic | pages/traffic.astro | SD511/CDOT m.fl.; Brookings saknar liveflöde | x | x | x | - | noindex (B) |
| Safety (Fire & air) | pages/safety.astro | brand + luftkvalitet | - | x | x | - | index |
| Holidays | pages/[holiday].astro + HolidayPage + config/holiday-pages/* | handskrivna confirmed/unconfirmed-fakta | x | x | x | x | index |
| Vote / results | vote.astro, election-results.astro | config/election.ts + resultat-API | x | x | x | - | index |
| Jobs | pages/jobs* | Adzuna | x | x | x | x | noindex (B,M,Bf) |
| Stadsspecifika | game-day, university, jackrabbits, play, farm-report (B); home-sales, month, sports, burro-bonanza (M); vail-resorts (Bf); christmas (G) | egna | | | | | |
| Statiska | about, how-we-gather-this, policy, contact, privacy, terms, cookies | text | x | x | x | x | index |
| /s/[slug] stories | pages/s/* | stories (AI) | x | x | x | x | noindex |

## 3. Granskningstabell (390 px, ordning = gissat sökintresse)
Princip-siffror = Del A. "Svar" = px ner (B Brookings, M Moreno, Bf Broomfield, G Glasgow).

| # | Sidtyp | Först i 390 px | Svar | Bryter | Föreslagen hjälte + insiktsrader |
|---|---|---|---|---|---|
| 1 | **Weather** | sign strip, H1 (3 rader), ingress, PageGuide, flood-länk | B 987, M ~1010, Bf ~925, G ~940 (timremsa); veckan B 1136, G 1076 | 1,3,4,5,6,7,8,9,11,12,14 | HeroStat nu-temp + väder i ord + hög/låg; "Dry until 3pm", "Rain from 6pm", "Colder tomorrow", "Cloudy all week" |
| 2 | **City hall / Meetings** | B: H1 + Next up direkt (svar 556); G: sektionsbild + AI-stycken; M/Bf: bild + lista | B 556, G 992, M 1126, Bf 1073 | B: 1 (inte hjälte-storlek), 5; G/M/Bf: "ingen AI-prosa", 3, 11 | HeroStat "Next: City Council in 5 days" |
| 3 | **Tonight** | H1, uppdaterad-rad, jättesiffran, "Up next"-kort | B 440, G 378 | uppfyller det mesta; saknar HeroStat-komponent, ikoner | referensen; behåll "N things on tonight", "Next up in 14 h" |
| 4 | **This week** (/this-week/YYYY-wNN/) | kicker, H1, AI-ingress (B), temagrupper | B 448 (AI-text), tema-listor från 1104 | AI-prosa (B), 3, 4, 10 | se beslutspunkt 3: Fas 5-sidan är en NY sida, inte denna |
| 5 | **This weekend** | H1, bild (190 px), antalsrader | B 705, G 657 | 1, 7, 10 (G 13,3 skärmar) | HeroStat "34 things on this weekend" + insiktsrader |
| 6 | **Holiday pages** | H1, "Closures and changed hours" | 394-494 | bra: svaret först; G /christmas/ 20 skärmar (princip 10, 11) | behåll struktur, lägg `AboutThisPage`, fäll ut långa grupper |
| 7 | **Today** | sektionsbild, PageGuide, sedan H1 | H1 B 969, M 1033, Bf 906, G 854 | 1, 11, 12 | HeroStat nu-väder + "N events today"; H1 överst |
| 8 | **Events** | bild, H1, ingress, PageGuide | B 1472, M 1462, G 1522 | 3, 7 (50-96 ramar), 8, 10 (13-22 skärmar), 11 | "N things on today", dagremsa |
| 9 | **Closure Watch** | bild, H1, text, PageGuide | B 1280, M 1329 | 1, 11, 14 | HeroStat "No closures announced" / "Closed tomorrow" |
| 10 | **What's On** | H1, ingress, AI-intro, Marquee | B 1159, M 771, Bf 718 | AI-prosa, 8, 10 (Bf 49 skärmar, M 23) | hjälte = närmaste marquee-datum |
| 11 | **Facilities** | H1, ingress, kategorilistor | B 778, M 822, Bf 769 | 3, 10 | "Open now: N" (bara med timdata) |
| 12 | **Traffic** | bild, H1, text | 1243-1364 | 14 (Brookings: "ingen livedata") | tomt läge-design |
| 13 | **Vote** | H1, resultatlänk, nyckeldatum | 826-932 | 11 | HeroStat "Election results" / dagar kvar |
| 14 | Jobs, Sports, Vail, Home sales, Farm, Game day | | | 8, 10 (Moreno Jobs 28 skärmar) | rundor i Fas 6 |
| 15 | Start (/) | skylt, H1, "Right now"-lista | B 489, M 506, Bf 494 | 1, 10 (6-10 skärmar) | sist; bygger på färdiga komponenter |

## 4. Återanvändning
- **Tonight-korten** (components/tonight/TonightCard, TonightRows, TonightChips, TonightStyles + lib/tonight-cards.ts, 48 tester): kategorifärgstokens `--tc-*` (ljus/mörk/dark-toggle), toppkant 4 px, jättetid, swipe-rad, chips-regel (>=3/>=2 = `CHIP_MIN_*`, `chipPlan`), badges (`badgesFor`), `heroFor`/`untilLabel` (insiktsrad), `dayView` (tomt läge). Källa för Card, Chips, HeroStat, Badge.
- **Äldre kortsystem** components/evening/* används fortfarande av /this-weekend/; ska ersättas, inte dubbleras.
- **Meetings** (lib/meetings-view.ts, 430+ r, testad): BODIES, `buildMeetings` (dedup), `substantiveItems`, `TOPIC_RULES`, `buildMeetingIcs`, `buildMeetingJsonLd`, `MEETINGS_TOWNS`, `nextMeetingDescription`, `relativeDays` ("in 5 days"). Bara Brookings är på. BODIES innehåller bara Brookings-organ (lärdom: Glasgow har 40+ organnamn, 26 Area Partnerships).
- **Områden:** config/areas/{glasgow 263, broomfield 10, moreno 9}.json + lib/areas.ts (`nearestArea`, `MAX_AREA_KM` 1,2). Brookings saknar areas-fil.
- **Venue-register:** configs/*.json evening_register (Glasgow 16, Broomfield 7, Brookings 0, Moreno 0), `facilities`-tabellen (resolveVenue/buildVenueIndex), lib/venue-tiers.ts (notable venues), osm_places (DB har snapshot för Broomfield 90 och Glasgow 254 platser, 2026-11-04; Brookings och Moreno saknar).
- **Free:** `isFreeEvent` (events.ts) bygger på facility-kategori (library/park/community_center); Glasgow-eventen har dessutom `raw_data.tickets` ("Free - Drop-in ...", 21 av 28 kommande) och `site_tags: ['Kids & families']` (13 av 28), `age`, `kind`, `recurrence`, `series_uid`: bättre källa än registret.
- **Helgsidor:** HolidayPage + lib/holiday-page.ts (confirmed/unconfirmed-modell, checkAt, link-only): redan ett standardmönster, nära målet.
- **Säsongsbilder:** lib/this-week-images.ts, section-hero.ts, SectionHero.astro: rotationen ska vara orörd.
- **Tokens:** BaseLayout `:root` (paper, surface, ink, accent, rule, font-head Newsreader, font-ui Bricolage Grotesque, font-data Plex Mono), accent-tokens.css (`brand.accent/accentInk/accentDark` per stad i site-config + lib/accent-contrast.ts), status-tokens, section-theme.ts.
- **Nav:** lib/nav-sections.ts + SectionNav.astro (sheet "All").

## 5. Väderdata per källa
Verifierat: Met Office mot fixtures i tests/fixtures (hourly 49 punkter, daily 8 dygn); NWS mot ett live-anrop 2026-11-05 (points, forecast, forecast/hourly, gridpoints; öppet API, projektets UA).

| Fält | Met Office (Glasgow) | NWS (B, M, Bf) | Lagras idag |
|---|---|---|---|
| Temp per timme | screenTemperature | temperature | ja (avrundad, enhet C/F) |
| Känns som | hourly feelsLikeTemperature; daily dayMaxFeelsLikeTemp, nightMinFeelsLikeTemp | **inte** i forecast/hourly; finns i gridpoints (apparentTemperature, heatIndex, windChill: ett 3:e anrop) | nej |
| Nederbördssannolikhet | hourly probOfPrecipitation; daily day/nightProbabilityOfPrecipitation | probabilityOfPrecipitation i både forecast och hourly | nej |
| Nederbördsmängd | totalPrecipAmount, precipitationRate, totalSnowAmount (timme) | endast gridpoints (quantitativePrecipitation, snowfallAmount) | nej |
| Vind | windSpeed10m + riktning | windSpeed + windDirection (text) | ja (som text "12 mph NW") |
| Byar | max10mWindGust, windGustSpeed10m; daily midday/midnight10MWindGust | endast gridpoints (windGust) | nej |
| UV | hourly uvIndex; daily maxUvIndex | **ingen** | nej |
| Soluppgång/-nedgång | **ingen** i källan | **ingen** | nej (is_daytime räknas ur solhöjd, `sunAltitudeDeg`) |
| Fuktighet, daggpunkt | screenRelativeHumidity, screenDewPoint | relativeHumidity, dewpoint (bara hourly) | nej |
| Väder i ord | significantWeatherCode -> tabell (WEATHER_TEXT) | shortForecast (text) | ja (`short`) |
| Ikon | kod -> egen ikon möjlig | icon-URL (hotlink, ej OK) -> egen ikon från shortForecast-text, osäkert | nej |
| Timdata, djup | 48 h tillgängligt, **24 lagras** | 156 h (6,5 d) tillgängligt, **24 lagras** | 24 |
| Dagar | 8 dygn (idag + 7), lagras som 14 rader dag/natt | 14 halvdygn (7 d) | 14 rader |
| Utfärdad/uppdaterad | modelRunDate -> `payload.issued` | updateTime/generatedAt i svaret | **bara Glasgow** (issued, source) |
| Observerad nutemp | nej (bara modell) | nej i forecast; observations-API finns (annat anrop) | nej |

Konsekvenser: (a) nästan alla Fas 2-insikter kräver att payloaden utökas (pop, känns-som, byar, UV) i **både** `cron-dispatcher/src/weather/{metoffice,nws}.ts` och Python-tvillingarna `scrapers/parsers/{met_office_site_specific_v1,noaa}.py` (paritetstest mot fixtur kräver lika resultat); (b) sidan måste tåla gamla payloads utan de nya fälten (= "inget utan data"); (c) `weather_snapshots` har ingen updated_at (bara created_at för dagens första rad, upsert uppdaterar inte den), så "Updated 10:00" kräver ett lagrat tidsfält i payload; (d) /api/weather + lib/live-weather.ts skriver om timremsa och dagslista genom att klona första noden, vilket inte bär den rikare DOM:en: nya komponenter måste kunna renderas om från samma pura modell i webbläsaren, eller live-uppdateringen väljs bort; (e) "Warmer than yesterday" kräver gårdagens snapshot (finns: Brookings 112 rader, Broomfield 71, Moreno 106, **Glasgow bara 14, från 23 okt**), och är då prognos-mot-prognos, inte observation.

## 6. Filplan (förslag, ingen kod skriven)
```
.claude/standards.md                       Del A ordagrant + standardlayouter (CLAUDE.md refererar)
site/src/design/ui-tokens.css              spacing 8 px, ytor, hårlinje 10 %, temperaturskala, kategorifärger (max 6) , typroller
site/src/components/ui/                    HeroStat, InsightLine, RangeBar, TimeStrip, Card, CompactRow, Chips, DayStrip,
                                           Pill, SectionHeader, WarningBanner, EmptyState, AboutThisPage, FallbackTile, Icon
site/src/lib/ui/insights.ts (+test)        alla insiktsmallar: regel, tröskel, mallsträng
site/src/lib/ui/icons.ts                   inline-SVG-set (väder, kategorier, organ, åtgärder), samma linjetjocklek
site/src/lib/ui/temperature-scale.ts       temp -> färg (+test)
site/src/lib/weather-model.ts (+test)      slår ihop dag/natt, run-length "all week", gemensam RangeBar-skala, nu-timme
site/src/lib/weather-format.ts             utökas (enhet, mph, "Updated")
site/src/pages/weather.astro               byggs om (Fas 2)
site/src/lib/live-weather.ts               skrivs om eller ersätts (Fas 2)
cron-dispatcher/src/weather/{metoffice,nws}.ts + scrapers/parsers/{met_office_site_specific_v1,noaa}.py + fixtures
                                           utökad payload (pop, feelsLike, gust, uv, fetched/issued), lockstep
site/src/lib/site-config.ts                nytt `ui`-block (units, ev. weatherExtras) och per-stads BODIES
site/src/lib/meetings-view.ts              BODIES flyttas till per-stad-config (Fas 3)
site/src/components/tonight/*              byggs om på ui/* (Fas 1)
site/src/lib/ui/standard-layout.test.ts    "samma komponent per sidtyp, inga stadskodvägar i layout"
galleri: se beslutspunkt 6
```
Fas 1-testet "inga kodvägar per stad": ett vitest som skannar pages/ och components/ui/ efter `townId ===`, stadsnamn och `siteConfig.country ===` utanför en vitlista (nav-sections har legitima per-stad-gates).

## 7. Beslutspunkter och osäkerheter (kräver ditt besked innan Fas 1/2)
1. **PageGuide överst -> AboutThisPage nederst** (se huvudfynd 2): bekräfta att den äldre regeln från 2026-10-22 ersätts.
2. **Tonen på "nu-temperaturen":** inga av källorna ger en *observerad* temperatur, bara modellvärdet för innevarande timme. Förslag: HeroStat "Now" = prognosens värde för aktuell timme, med "Forecast" i metaraden och förklaring i About. Alternativ: NWS observations / annan källa (ny datakälla, kräver ditt ok).
3. **Fas 5 är en NY sida, inte befintlig /this-week/[vecka]/.** Den bygger "47 things on in Glasgow", DayStrip och Pick of the week på events; /this-week/ är idag en veckoarkivsida med AI-ingress. Vilken URL ska Fas 5 bo på (/this-week/ ersätts, /events/ byggs om, eller ny)? Påverkar SEO, så ditt ja krävs.
4. **"Updated 10:00":** Glasgow har `issued` (modellkörning, ex 08:00Z), US har ingen. Förslag: lagra `fetched_at` (när vi senast hämtade, timvis) och visa det; alternativ `issued` (när källan publicerade).
5. **AI-text på mötes-, whats-on- och veckosidor:** "ingen AI-prosa" innebär att `Recent meetings` (Brookings, nu AI-sammanfattningar), Glasgows/Morenos/Broomfields mötesstories, /whats-on/-introt och veckoingressen försvinner eller ersätts av rena datarader. Bekräfta omfattning (Fas 3 rör mötena, resten Fas 6).
6. **Galleriet /_design/:** Astro räknar bort filer och mappar som börjar på `_` i pages/, så `pages/_design/` blir ingen route. Förslag: `pages/[design].astro` med getStaticPaths (['_design']), noindex + bort ur sitemap-filtret (astro.config.mjs) + `verify_sitemap_noindex_disjoint`, och **byggt bara när `BUILD_DESIGN=1`** så att den inte deployas till de levande sajterna. Alternativ: levande men noindex. (Rekommendation: bara lokalt/preview.)
7. **Soluppgång/-nedgång:** finns i ingen källa. Kan *räknas* ur lat/lon + datum (formeln finns redan för is_daytime), men det är beräkning, inte källdata. Tillåtet i "Sol"-raden, märkt "calculated"? Annars utgår raden.
8. **NWS-extras (känns som, byar, mängd)** kräver ett tredje anrop (gridpoints) per stad och timme. Ta med (US får då "Feels like") eller hoppa över (US visar den raden aldrig)? UV finns inte för US i något fall.
9. **Typsnitt:** "sans med tabular-nums" men basen är Bricolage Grotesque (via Google Fonts, redan extern). Stöder den `tnum`? Okänt, mäts i Fas 1. Titelserif = Newsreader (behålls). Plex Mono tas bort ur datarader men kan stå kvar i kod/preformaterat.
10. **Glasgow-väderhistorik** är bara 14 dagar: "Warmer than yesterday" fungerar (gårdagen finns), men säsongsjämförelser inte.
11. **OSM/areas:** Brookings har ingen areas-fil och varken Brookings eller Moreno har osm_places-snapshot (Open late/"område på rad" saknar där källa). Fas 4 får därför bara Glasgow och Broomfield på OSM-område, Moreno har 9 egna areas.
12. **Moreno-bugg "23:30":** hittade ingen reproduktion i DB (de 109 events på 00:00 UTC är 1-timmars bibliotekspass kl 16-17 PT, alltså korrekta). Behöver ursprungsrapporten (sida + event) för att skriva regressionsfixturen i Fas 4.
13. **Fas 3 före bygget:** BODIES-förslag per stad behöver ägarens läsning; data finns (Glasgow 40+ organ varav 26 Area Partnerships, Broomfield 6 typer av council-möten, Moreno 5, Brookings 25). Moreno har 0 kommande möten (data) = tomt läge; Broomfield har 9 kommande.

## 8. Föreslagen ordning efter Fas 0
Fas 1 (tokens + bibliotek + standards.md + galleri + Tonight-omskrivning) -> Fas 2 (väder Glasgow, sedan US) -> Fas 3 (meetings) -> Fas 4 -> Fas 5 -> Fas 6 i tabellens ordning (Today, Closure Watch, Events, This weekend, What's On ...).
