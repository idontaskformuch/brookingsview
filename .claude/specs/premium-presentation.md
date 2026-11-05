# Handoff: Premium-presentation av data – standardlayouter för alla sajter

(Ägarens handoff 2026-11-05, sparad ordagrant. Fasrapporter: .claude/specs/premium-phase<N>-report.md.)

## Mål
Allt vi skrapar ska presenteras så att blicken fastnar direkt och besökaren vill fortsätta. Premium, genomtänkt, lugnt. Vi bygger ETT designsystem och ETT komponentbibliotek. Varje sidtyp är en standardlayout som alla städer delar. Städer skiljer sig bara i config (data, tidszon, enheter, stavning US/UK, accentfärg, organ- och områdesmappningar).

## Hårda regler
- **Ingen AI-prosa.** All text är källdata eller mallsträngar byggda av datafält, med tester.
- **Inget utan data.** Ingen siffra, badge, insikt, chip eller ikon visas om datan saknas. Gissa aldrig.
- **Svaret först.** Det besökaren söker syns utan scroll i 390 px. Förklaringar, källor och disclaimers samlas under "About this page" längst ner. Enda undantaget är aktiva varningar, som visas som banner överst.
- Title-taggar ändras inte utan mitt ja (SEO). H1 får kortas.
- Inga hotlinkade bilder, ingen extern JS utöver det som redan används.
- Inga arbetsgivarnamn eller referenser utanför projektet i kod, commits eller docs.

## Arbetssätt
Stanna efter varje fas, rapportera och vänta på mitt OK. Jag kör /clear mellan faserna. Uppdatera `.claude/state.md` efter varje fas. Batteriet ett i taget med exit-koder. Committa lokalt och pusha aldrig utan att jag skriver ja.
**Rapport per fas:** ändrade filer, skärmdumpar 390 px och 1280 px (mörkt och ljust, före och efter), osäkerheter, nästa steg.

---

## Del A: Designprinciperna (skrivs in i standards.md och gäller allt)

1. **En hjälte per vy.** Varje sida och sektion har ETT dominerande element: nu-temperaturen, nästa möte, "in 26 min". Det är 2–3× större än allt annat. Resten underordnas.
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
12. **Färskhet synlig.** "Updated 10:00" i en diskret metarad nära toppen, från datan.
13. **Rörelse sparsamt.** Mjuka övergångar vid filtrering och utfällning. Inget blinkande, allt av under `prefers-reduced-motion`.
14. **Tomma lägen är design.** Varje komponent har ett genomtänkt tomt läge (en rad + vart man går i stället). Aldrig en rubrik utan innehåll, aldrig "0 things".
15. **Prestanda är premium.** Ingen layoutförskjutning, mål LCP < 2,5 s i mobil, inga onödiga beroenden.

## Del B: Komponentbiblioteket (delat, alla städer)
- `HeroStat`: jättesiffra + etikett + insiktsrad.
- `InsightLine`: mallsträng med regel, tröskel och test.
- `RangeBar`: min–max över en gemensam skala (t.ex. veckans temperaturer).
- `TimeStrip`: horisontell swipe-rad för timmar eller dagar, med valfri sparkline/stapel under.
- `Card` (toppkant 4 px i kategorifärg) och `CompactRow` (vänsterkant 3 px).
- `Chips`: filter, regeln ≥3 per chip och ≥2 chips, inga siffror.
- `DayStrip`: sticky dagremsa med antal.
- `Pill`/`Badge`: Free, Kids, Weekly osv., bara med data.
- `SectionHeader`: kicker + rubrik + valfri insiktsrad.
- `WarningBanner`: aktiva varningar överst.
- `EmptyState` och `AboutThisPage`.
- `FallbackTile`: kategorigradient + ikon + namn, inga stockfoton.
Alla med delade design-tokens (färg, typografi, spacing, ytor, temperaturskala) och accentfärg från site.config. Tonight-korten är utgångspunkten: extrahera dem, uppfinn inte nytt.

**Galleri:** en intern sida `/_design/` (noindex, utesluten ur sitemap) som visar varje komponent med riktig data i mörkt och ljust läge, inklusive tomma lägen. Där granskar jag helheten.

---

## Fas 0: Inventering (inga ändringar)
1. Kartlägg alla sidtyper på alla fyra sajterna: komponent, datakälla, fält och täckning.
2. **Granskningstabell per sidtyp:** vad står först i 390 px, var hamnar svaret (pixlar ner), vilka principer i Del A som bryts och föreslagen hjälte och insiktsrader. Sortera efter trafik om den finns, annars efter min gissning av sökintresse (väder, möten, tonight, this week, helgsidor).
3. Vad finns redan och ska återanvändas: Tonight-kort, meetings-view (BODIES, dedup, procedurfilter, .ics, JSON-LD), områdesmappningar, venue-registret, helgsidor, säsongsbildrotation.
4. Väderdata: vilka fält ger källan per stad (temp, känns som, nederbördssannolikhet/-mängd, vind, byar, UV, soluppgång/-nedgång, timdata hur långt)?
5. Föreslå filplan. Skriv ingen kod.

## Fas 1: Designsystem, komponenter, standards.md
1. `.claude/standards.md`, refererad från CLAUDE.md: Del A ordagrant + varje standardlayout (syfte, komponent, config-fält, tomma lägen, tester). Börja med Navigation, Helgsidor, Tonight och Meetings.
2. Delade tokens + komponentbiblioteket (Del B) + `/_design/`-galleriet.
3. Tonight byggs om på biblioteket och ska se likadan ut efteråt (skärmdumpar före/efter).
4. Test: alla städer använder samma komponent per sidtyp, inga kodvägar per stad i layouten.

## Fas 2: Pilot, vädersidan (Glasgow först, sedan alla)
Ordning uppifrån:
1. `WarningBanner` om varning är aktiv.
2. H1 "Glasgow weather" + metarad "Met Office · Updated 10:00".
3. **HeroStat:** nu-temperaturen stort, väderikon, väder i ord från källan, "Feels like" (om fält finns), dagens hög/låg. Insiktsrader enligt regler, t.ex. "Dry until 3pm" / "Rain from 6pm" (nederbördssannolikhet över tröskel, timdata), "Warmer than yesterday" eller "Colder tomorrow" (skillnad ≥2°).
4. **Next 24 hours:** `TimeStrip` med tid, ikon, temp och en tunn temperaturkurva genom kortet, plus regnstaplar om nederbördsdata finns.
5. **Week ahead:** en rad per dag med dag- och nattvärden ihopslagna (inte separata rader). Ikon, låg, `RangeBar` på veckans gemensamma skala färgad med temperaturskalan, hög och regnrisk. Samma väder ≥3 dagar i rad ger insiktsraden "Cloudy all week" ovanför.
6. Vind, byar, UV och sol bakom tryck per dag (`<details>`).
7. Ingen varning: en liten rad + SEPA Floodline (UK) eller motsvarande i config (US).
8. `AboutThisPage`: dagens förklaringstext oförändrad.
Enheter från config (UK: °C, mph; US: °F, mph). Mål: nu-temperaturen och dagens insikt syns utan scroll i 390 px. Tester för varje insiktsregel, inklusive att den inte visas utan data.

## Fas 3: Meetings som standard på alla städer
- Brookings-versionen flyttas till biblioteket. Next up blir `HeroStat` ("in 5 days").
- Per stad: `BODIES`, tidszon, stavning, ämnesetiketter på/av, länk till officiell agendasida.
- Title och H1 oförändrade, bara meta-description får "Next: …".
- Tomt läge: "No upcoming meetings posted yet" + länk. Recent och arkivet visas som vanligt.
- Broomfield: sandbox-spärren gäller. Moreno: tomt läge tills scraper-stoppet är utrett. Glasgow: organ-chips, ämnesetiketter av.
- **Före bygget:** visa `BODIES`-förslag per stad, dedup-fall och 3 exempelmöten. Vänta på mitt ja.

## Fas 4: This week, data (bara det som saknas)
- Tid i stadens tidszon med samma kod som Tonight. Test: ett event 23:30 hamnar på rätt dag (känd Moreno-bugg).
- Återkommande: enum `one_off | weekly | monthly | regular`. "Regular" visas aldrig.
- Titelstädning: venue-namn bort ur titeln när det också är venue. Alias-matchning mot venue-registret, med tester (även negativa).
- Område: OSM-stadsdel på rad, grova områden för chips.
- Free från venue-registret. Kids/adults_only bara om källan har fältet.
- Civic läses från meetings-view.

## Fas 5: This week, layout (Glasgow först)
1. `SectionHeader`: kicker "THIS WEEK", hjälte "47 things on in Glasgow", "· 19 free" bara med Free-data och N > 0. Bakgrund: säsongsbilden (befintlig rotation orörd) med mörk gradient.
2. `DayStrip`: sticky, antal per dag, idag i accent. Lör/sön scrollar till This weekend. Tryckyta ≥44 px. Färre än 5 events döljer remsan.
3. `Chips`: Today · Tonight · Free · Kids & family (bara med data) + områden enligt standarden.
4. **Pick of the week:** stort `Card` med `FallbackTile` 16:9. Regelbaserad poäng: +3 helg/kväll, +2 bild, +2 notable venue, +1 gratis, −5 civic, −2 små veckogrupper. Lika → tidigast start. Poäng i bygglogg.
5. **Mån–fre daggrupperat:** sticky dagrubrik, `CompactRow` med stor tabulär tid i fast kolumn, serif-titel, `venue · område`, pills och ↻ för återkommande.
6. **At the council this week:** kompakt yta, organ · dag · tid, agendapunkter via `<details>`. Rör inte mötes-stories eller /city-hall/.
7. **This weekend:** annan bakgrundston, swipe-karusell med kort + kompakt lista.
8. "All N events this week →".

## Fas 6: Resten av sajten
Bygg om övriga sidtyper på biblioteket i den ordning granskningstabellen från fas 0 anger, en sidtyp per runda. Före varje: visa föreslagen hjälte, insiktsrader och ordning, och vänta på mitt ja.

## Fas 7: Utrullning
En stad i taget via config, med batteri och skärmdumpar per stad. Lägg varje färdig sidtyp i standards.md. Uppdatera "How we gather this" där dataflödet ändrats.

## Senare, egen körning (bygg inte nu): venue-bildbibliotek
Commons (CC-BY/CC-BY-SA/PD) → Unsplash → egna foton. Skriptet föreslår bara kandidater i granskningsfil, och inget laddas ner före mitt ja. AVIF + WebP i 3 bredder, `srcset`, lazy (pick-bilden `fetchpriority="high"`, ≤120 kB). Kreditrad + sida med bildkrediter.
