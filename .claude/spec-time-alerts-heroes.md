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

## Fas 0-5 (klara och pushade; detaljer i .claude/state-archive.md, avsnitt B)
- Fas 0 utredning: klar, inga ändringar (fynd rapporterade 2026-10-20).
- Fas 1 varningar och tidskänsliga statusar: 8980ee1 (+ county_alert/skyltremsa senare: ea8ff6b, 09ba9ae).
- Fas 2 gating av heat/dust och statusfärger: cd17e85 (renderingstest a3e92ca).
- Fas 3 datumbricka i stället för kalender-emoji: 615ad2d.
- Fas 4 sektionshero via säsongsrotation: 0b69943 (månadsvis rotation c9de086, låga mobil-heroes 077fb8c).
- Fas 5 stavning och konsekventa etiketter: 32b8a1b.

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
