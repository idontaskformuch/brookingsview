# Handoff: Tid, varningar och sektionsbilder (alla städer) -- 2026-10-20

Inget committas/pushas förrän ägaren sagt till. Fas 0 = bara utredning, rapportera före Fas 1.

## Bakgrund
Ingen stadssajt ska kunna visa utgången varning, felaktig status eller fel datum. Brookings /today och /events (19-20 okt) visade:
1. Dense Fog Advisory från 10/12 kvar under "Right Now".
2. Freeze Warning "till 9 AM CDT Saturday" visad mån+tis, bredvid "High 68F sunny".
3. /today "as of 11:33 AM local" kl ~14:25 CDT, samtidigt "City Hall open - closes 5:00 PM".
4. Grön ruta "Safe for outdoor & loading-dock work" på Brookings, mintgrön text på mintgrön bakgrund.
5. 📅 renderas på iOS som "JUL 17" bredvid evenemang 20 okt.
6. Hero på /events alltid samma sommarparad från Pexels, annan stad, läsbara butiksskyltar.
Allt byggs i gemensam kod: Brookings, Moreno Valley, Broomfield.

## Fas 0: Utred (belagda fynd, anta inget)
1. Var kommer gröna rutan ifrån? (Troligen heat/dust-advisory från Workplace Watch Phase 2, bara MV.) Komponent, hur den hamnar på /today, varför gating inte stoppar Brookings.
2. Varför /today 3 h gammal? Körs timbygget + deployar för alla tre? Senaste lyckade deploy per Cloudflare-projekt mot schema.
3. Tidsfält på sparade varningar (effective, onset, expires, ends, sent): vad lagras, vad filtrerar listningen på. Ta fram fog (10/12) och freeze i DB, förklara varför de visas.
4. Inventera tidsrelativ text vid build ("today","tonight","open/closed","in N days","N events today","as of"): build- eller browser-beräknat, vilken tidszon.
5. Emojier som ikoner i src/ (📅 m.fl.).
6. Hero-val per sektion: var /events-bilden sätts, andra fasta sektionsbilder vs rotationen för "This week".

## Fas 1: Varningar och tidskänsliga statusar
Hellre utelämna än visa fel.
- Visa varning bara om slut i framtiden: ends först, annars expires. Saknas båda: dölj 12 h efter sent.
- En delad funktion activeAlerts(town, now) för statusremsa, Right Now, /today, Closure Watch, CityStatus.
- data-ends-attribut; dölj i browser när tiden passerat.
- Visa sluttid i stadens lokala tid med veckodag+datum ("until 9 AM Sat Oct 24").
- Öppet/stängt räknas i browser från strukturerade öppettider i stadens tz (America/Chicago, Los_Angeles, Denver). Utan JS: bara öppettider, aldrig open/closed.
- "N events today", "in N days", Today/Tonight/This weekend: browser-beräknat, eller dolt när bygget >2 h gammalt.
- Passerade evenemang aldrig under Today/Tonight.
- "as of" = riktig byggtid; >2 h gammal: diskret markering.
- Om Fas 0 visar att timbygget inte körs: åtgärda, högljutt fel vid misslyckad deploy.

## Fas 2: Gating och status-styling
- Heat/dust-advisory: flagga i per-stad features-config, default av, på bara för MV. Rendera bara vid faktisk varningsnivå ("safe" visas inte). Läckagetest: Brookings/Broomfield-bygget får inte innehålla "loading-dock" eller komponenten.
- Statusfärger via gemensamma CSS-variabler (--status-ok/-warn/-alert, separata text/bakgrund). Utöka WCAG-kontrollen (Local Accent Identity) till dem; bygget fallerar under 4.5:1. Ingen mintgrön-på-mintgrön; status = liten färgad punkt/kant, text i vanlig färg. "--" -> "–". Variablerna ska kunna få mörka värden under prefers-color-scheme: dark (själva dark theme ingår inte).

## Fas 3: Emojin och datumbrickor
- Ta bort 📅 överallt; ersätt med CSS-datumbricka ("OCT / 20", stadens tz) eller ingen ikon. Samma för andra ikon-emojier. Test som fallerar om 📅 eller 🗓 finns i src/ (sajtkoden).

## Fas 4: Sektions-heroes via säsongsrotation
- Delad resolver getSectionHero(town, section, date) på befintlig rotationspool/datumintervall. Inga hårdkodade bilder.
- Startsidans regler: ny bild minst varje vecka, ingen repris inom 2 mån, säsong/högtider, mix stad/byggnader/natur.
- Deterministiskt per stad+sektion+ISO-vecka; sektioner delar inte bild med startsidan eller varandra.
- Valfri reservbild per sektion, bara om poolen tom; saknas båda: bygget fallerar.
- Inga bilder med annan identifierbar plats (skyltar, butiksnamn, landmärken). Ta bort paradbilden från /events, kontrollera övriga fasta.
- Behåll fotografattribuering.
- Minst /events, /today, /city-hall, /closures, Farm Report + alla Fas 0 hittar.

## Fas 5: Textpolish
- "organiser's" -> "organizer's" i /events-intro. Sök övriga brittiska stavningar (-ise, -our, -tre) i statisk text; AI-genererat orört. Konsekventa kategorietiketter på evenemang.

## Verifiering (tester med fejkad klocka, alla tre städer)
- 23:59/00:01 lokal tid, 16:59/17:01 öppettider, 3 h gammalt bygge.
- DST: tillbaka söndag 1 nov 2026; varningar/evenemang över 01:00-02:00.
- Maskin-TZ UTC och Europe/Stockholm.
- Fog-varningen 10/12 som fixtur -> noll aktiva.
- Heat/dust-widget finns bara i MV-bygget.
- Bilder: 10 veckor framåt, ingen repris inom 2 mån, ingen sektion delar bild med startsidan samma vecka.
- Visuellt: mobilskärmbilder /today, /events, startsida x3 städer, före/efter.
- astro check, pytest, vitest gröna, alla tre bygger.

## Fas 6: Dark mode (tillagd 2026-10-20)
Börja FÖRST när Fas 1-5 är godkända och committade (färgändringar får inte blandas med Fas 2).
- Läge: följ prefers-color-scheme. Manuell växlare (sol/måne) i headern skriver över, sparas i localStorage (läs i try/catch). Litet inline-script i <head> sätter läget så sidan inte blinkar ljust.
- Färger: allt via CSS-variabler; varje variabel får mörkt värde (bakgrund, text, länkar, kort, avdelare, formulär, statusremsa, status-variablerna från Fas 2). Hårdkodade färger i komponenter flyttas till variabler först.
- Accent: Local Accent Identity får mörka varianter per stad (inkl. Broomfields slate-teal); den genererade stilmallen innehåller båda lägena.
- Kontrast: WCAG-kontrollen körs på båda lägena; bygget fallerar under 4.5:1 i något läge.
- Bilder: säsongs- och hero-bilder oförändrade. Spelens canvas och inbäddat innehåll (kartor, tredjepartswidgets) orörda.
- Utrullning: gemensam kod; verifiera på Brookings först, sedan alla tre.
- Verifiering: skärmbilder i båda lägena, mobil+dator, av startsida, /today, /events, en story-sida, en facility-sida och /play. Testa växlaren, att valet minns mellan sidor, och att sidan fungerar utan JS.

## Ägarbeslut under Fas 1 (2026-10-20)
- Ingen ny cron; Today/Tonight klientberäknas; "as of" -> "Updated <tid>".
- county_alert: filtrera bort category 'Hazardous Weather Alerts' från varningsytorna (dubbletter + Iowa-felet; de 3 missade NWS-varningarna förloras, OK). Gamla county_alert-rader (vägarbeten 2022-23) ska inte nå varningsytorna alls. ends_at NULL -> dölj efter 24 h.
- Bara 📅 byts i Fas 3; övriga ikon-emojier listas för senare. Fas 4 återanvänder selectThisWeekImage.
- dist_*/ i .gitignore. Bekräfta MV+Broomfield-bygge och sitemap/noindex-kontroll, sedan Fas 2.
