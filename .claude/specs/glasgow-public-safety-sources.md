# Glasgow public safety: källrapport (bara läsning, inget byggt) -- 2026-10-29

Fråga: kan Police Scotland och SFRS ge oss officiella "avoid the area / stängda vägar / rök" automatiskt, enligt public-safety.md-reglerna (robots/villkor först, ingen AI-text, ingen brottsrapportering)?

## robots.txt (lästa 2026-10-29, User-agent ViewMediaBot)
- scotland.police.uk: bara `Disallow: /what-s-happening/news/2020/` och `/2021/`. Inga AI-botregler.
- firescotland.gov.uk: bara tekniska mappar (/umbraco/, /bin/, /config/ ...). Inga AI-botregler.
- traffic.gov.scot: standard Drupal-robots, inga AI-botregler.
=> Botregeln hindrar inte, men robots är inte samma sak som tillstånd att återpublicera.

## Flöden
- Police Scotland: ingen RSS/Atom hittad (/rss, /what-s-happening/news/rss = 404). Nyhetssidan är HTML. Innehållet är till största delen brott, gripanden och efterlysningar = precis det spec:en utesluter. Inget strukturerat flöde för "avoid the area" eller vägavstängningar.
- SFRS: ingen RSS hittad (/rss, /news/rss = 404). Nyheter är HTML, ofta med namngivna personer och skador (t.ex. fyrverkeriolycka 2026-10-29). Inget publikt live-incidentflöde. SFRS lägger öppna data på Scottish Governments dataportal (inte realtid).
- Trafikavstängningar finns hos Traffic Scotland (Transport Scotland): DATEX II-flöde för oplanerade händelser, vägarbeten, VMS. Kräver registrering och godkännande, villkor och DATEX-mottagare. Licens ej bekräftad. Ett ITS-direktivdataset om vägsäkerhet finns på data.gov.uk under OGL, men det är inte livehändelser.
- Met Office (varningar) och SEPA (översvämning) finns redan på sajten.

## Villkor
- scotland.police.uk: ingen hittad villkors-/copyrightsida (/terms-and-conditions/ m.fl. = 404). Systersajten mipp.police.uk (Police Scotland som huvudman) säger att rättigheterna är förbehållna och att innehåll får användas för eget, icke-kommersiellt bruk; kommersiellt bruk kräver licens.
- SFRS "Reuse regulations" (2023-09-18): "assume that the re-use of the information is not permitted" om man inte fått skriftligt besked. Motsägs av mygov.scot-listningen (text under OGL v3.0, ej grafik) -- oklart, räkna inte med OGL.

## Slutsats / förslag (ägaren avgör)
1. Ingen automatisk återpublicering från Police Scotland eller SFRS: villkoren ger inget klart tillstånd, flödena saknas och det som finns är brottsnyheter (utesluts av spec:en).
2. Det som går: en ren LÄNKRAD på Glasgows /safety/ (inget hämtat): Police Scotland "Your community team"/rådsida, SFRS "Home safety"/"Outdoors", Traffic Scotland incidents (traffic.gov.scot/traffic-information/incidents), Met Office och SEPA Floodline (finns). Evakuering/stängningar: bara länkar, samma modell som Moreno/Broomfield.
3. Vill ni ha trafikavstängningar som data: skriv till datex2@trafficscotland.org (registrering, villkor, licens) och till SFRS/Police Scotland om skriftligt återanvändningstillstånd. Först efter svar kan något byggas.
4. Fråga till ägaren: ska Glasgow få en länk-/safety/ enligt punkt 2 nu, eller vänta?
