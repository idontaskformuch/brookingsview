# Broomfield: plan för strukturerade facility-data (2026-11-04, ENDAST PLAN, inget hämtat, inget skrivet)

Ägarens beslut 2026-11-04: ingen AI-utfyllnad. Öppettider, telefon och parkering för de 46 platserna hämtas från officiella källor, med källa per fält. Sidor som inte kan beläggas är noindex tills data finns.

## Nuläge (live-databasen, bara SELECT, 2026-11-04)
46 platser: 25 parker, 7 brandstationer (North Metro Fire), 2 postkontor, 2 RTD-stationer, 1 sjukhus, 2 museer, 3 community/rec-center + Bay Aquatic Park, bibliotek, polis, stadshus, återvinning, 5 "other" (auditorium, tingsrätt, Health & Human Services, Workforce Center).
| Fält | Har värde | Saknas |
|---|---|---|
| Adress | 46 | 0 |
| Webbplats | 46 | 0 |
| Telefon | 27 | 19 (nästan alla parker, båda RTD-stationerna) |
| Strukturerade öppettider (place_hours) | 14 platser, 86 rader | 32 (alla parker utom skate park, brandstationer, sjukhus, RTD, stadshus, Bay) |
| hours_structured (JSON) | 3 | 43 |
| Parkering (parking_note) | 0 | 46 |
| Egen beskrivning | 16 | 30 |
Källa som redan finns i raden (source_url): www.broomfield.org 35, northmetrofire.org 7, tools.usps.com 2, broomfieldveterans.org 1, cumedicine.us 1.

## Källa per fält och plats (förslag)
| Grupp | Platser | Fält som kan beläggas | Officiell källa (egen sida) | Anmärkning |
|---|---|---|---|---|
| Parker | 25 | telefon (Parks & Recreation-huvudnumret om sidan anger det), tider (bara om parksidan anger dem; annars visas ingen tid, inte "dawn to dusk" på gissning), parkering (om parksidan nämner den), faciliteter (finns som services) | broomfield.org, respektive parks sida | Troligen svagast: många parksidor anger bara faciliteter. Den som inte kan beläggas förblir tunn och noindex. |
| Brandstationer | 7 | tider (om sidan anger bemanning), parkering sannolikt N/A (inte öppna för besök) | northmetrofire.org stationssidor | Telefon finns. Behåll noindex om inget besökarvärde kan beläggas. |
| Stadshus, tingsrätt, H&HS, Workforce, auditorium, polis, återvinning, museer, community center, rec center, bibliotek, Bay | 14 | tider (flera finns), telefon (finns), parkering | broomfield.org facility- och avdelningssidor; bibliotekets egen sida; broomfieldveterans.org | Bästa utdelningen: här fylls parkering och de tider som saknas (stadshus, Bay). |
| Sjukhus | 1 | tider (24/7 akut om sidan anger det), parkering | uchealth.org platssida | Telefon finns. |
| RTD-stationer | 2 | parkering (antal platser), telefon (RTD kundtjänst) | rtd-denver.com stationssida | Sidan är JavaScript-tung; om rå-HTML saknar uppgiften beläggs den inte. |
| Postkontor | 2 | tider | usps.com / tools.usps.com | Locator-sidor är dynamiska och sannolikt robots-spärrade: kan troligen inte hämtas; tider kommer då från en egen källa eller utelämnas. |

## Metod (inga AI-genererade fält)
1. Robots först, per domän, med ViewMediaBot (broomfield.org: Crawl-delay 10; observera att broomfield.org nyligen stängde `/common/modules/icalendar/`, `/RSS.aspx` och `/calendar.aspx`, men inte facility-sidorna; AI-botlistan i filen omfattar inte ViewMediaBot men ska läsas om vid körning). Stoppa vid 403/timeout/5xx. Högst en hämtning per sida och dygn.
2. Fältvärdet läses ur sidans egen text (tid, telefon, parkeringsrad) av ett skript eller för hand, aldrig genererat. Varje värde sparas med: fält, värde, citat ur källan (exakt textutdrag), källans URL, hämtdatum. Saknas citatet i sidan förkastas värdet.
3. Resultatet visas för ägaren som en tabell (plats, fält, gammalt värde, nytt värde, citat, URL) INNAN något skrivs. Ägaren godkänner; först då skrivs det mot live-databasen (regel 7), via en committad skriptfil som skriver bara godkända rader.
4. Beskrivningar skrivs inte av en modell. Antingen en kort sakmening som följer av de belagda fälten (t.ex. "Open [tider]; parking: [citat]") genereras av mallen på sidan, eller så lämnas beskrivningen tom.
5. Platser som efter detta fortfarande har under 25 egna ord eller saknar tider/parkering förblir noindex (regeln thinFacilityMinOwnWords är redan införd för Broomfield i den samlade ändringen).
6. Färskhet: verified_date sätts per fält-hämtning; rader äldre än 90 dagar flaggas för omkontroll (förslag).

## Ordning (ägarens beslut 2026-11-05)
Brandstationerna förblir indexerbara. Prioritet:
1. STADSHUSET (George Di Ciero City and County Building, `city-hall`) och POLISEN (`broomfield-police-department`) först: dessa två är de viktigaste uppslagssidorna och föll nyss ur sitemap (24 respektive 16 egna ord, under tröskeln 25). Fält: öppettider, adress, telefon (för polisen den ICKE-AKUTA numret, aldrig 911; verifiera mot polisens egen sida och märk det "non-emergency"), parkering, med källa per fält (egen sida på broomfield.org, citat + URL + hämtdatum). Båda väntar sedan på ägarens tabellgodkännande innan skrivning.
2. Brandstationerna (7 st: HQ och station 61, 64, 65, 66, 67, 68): adress, icke-akut telefon, källa per fält ur northmetrofire.org stationssidor. Behåller indexering enligt ägaren; sidorna har idag 28-53 egna ord och passerar tröskeln, men saknar tider och parkering, så ingenting får påstås utöver det sidan belägger (t.ex. ingen "öppet 24/7" utan källa; stationer är normalt inte öppna för besök och det ska sägas om källan säger det).
3. Därefter gruppen med bäst utdelning (bibliotek, rec/community center, museer, återvinning, övriga kommunala tjänster), sjukhus och RTD, parker, postkontor, enligt tabellen ovan.
Efter varje steg: tabell till ägaren (plats, fält, gammalt/nytt värde, citat, URL), godkännande, skrivning via committad skriptfil, bygge, kontroll av noindex-listan.

## Vad jag inte vet än
- Vilka av de 25 parksidorna anger tider eller parkering alls (inte läst parksida för parksida).
- Om tools.usps.com och rtd-denver.com tillåter hämtning enligt robots (RTD:s robots.txt returnerade en JavaScript-sida, inte en textfil).
- Om stadshusets och Bay Aquatic Parks tider finns som löptext eller bara som PDF/bild.
