# Kvälls- och helglagret: vad som återstår (2026-11-04, ENDAST SPEC, inget byggt)

Mål: "vad gör vi ikväll?" och "vad händer i helgen?" i alla fyra städer, och att sökningar som "happy hour <stad>", "best coffee <stad>" och "restaurants open late" kan landa här. Redaktionella grundregeln gäller: data -> vad betyder det -> vad kan läsaren göra. Ingen AI-text som ersätter data.

Bygger på, ersätter inte: .claude/specs/weekend-layer.md (beslut och skydd), .claude/specs/evening-register-proposal.md (ställelistor), .claude/t1-report.md (källmätningar 2026-10-28). Där det finns konflikt gäller weekend-layer.md.

## 0. Nuläge (läst i koden 2026-11-04)
BYGGT och live: /tonight och /this-weekend (alla fyra städer; tröskelmotor lib/evening-threshold.ts med hysteres, ett beslut per bygge i lib/evening-verdict.ts, config `eveningLayer` per stad), Ticketmaster med radie per stad (Glasgow 15 mi, Broomfield 20, Moreno 35, Brookings 75), egna events, "Open late" ur OSM (lib/osm-open-late.ts), kuraterat register med robots- och identitetskontroll (scripts/refresh_evening_register.py, migration 064, Haiku läser ställets egen sida, valideras mot sidan). Indexering: Broomfield godkänd (indexApproved), Glasgow enligt tröskel+godkännande, Moreno noindex tills tröskeln nås, Brookings `never` (noindex för gott).
INTE byggt: /food-drink/ och de tre navsidorna (happy hour, open late, coffee), registret för Brookings och Moreno (T1 hittade nästan inget i OSM där), "Add your event" (ligger i backlog.md).
Konsekvens: den här specen handlar om tre saker: (A) fylla registret i Brookings/Moreno, (B) mat- och dryckesnavsidorna, (C) göra Brookings användbart utan att låtsas att staden har fler kvällsevent än den har.

## 1. Datakällor per stad
Regler som gäller alla: ViewMediaBot, högst en hämtning per ställe och dygn, robots.txt först (404 = tillåtet; 403/timeout/5xx/ingen DNS = hoppa över; ställe som nämner AI-botar generellt eller har `Disallow: /` utesluts), identitetskontroll före varje extraktion, aldrig Facebook/Instagram/Google Maps/Yelp, inga hotlinkade bilder.

| Källa | Brookings | Moreno Valley | Broomfield | Glasgow |
|---|---|---|---|---|
| Ticketmaster Discovery (finns) | 5 kvällsevent på 25 mi, 33 på 75 mi (mest sport) | 67 på 20 mi, 168 på 35 mi | 395 på 20 mi (15 på 10 mi) | ~297 på 15 mi (~10/kväll) |
| Egen events-tabell (finns) | bibliotek 33, kammare 2 (28 d framåt) | bibliotek 67, stadens event 16 (fre-sön), farm house 4 | 0 | glasgow_life 43 (2 på kvällen) |
| OSM pub/bar/klubb/musik | 14 ställen, 4 med webb, 0 öppettider | ~0 | 34 ställen, 25 med webb, 20 öppettider | ~465 pubar/barer/klubbar/musiklokaler, 188 av 530 med webb, 114 med öppettider |
| Kuraterat register | ~15 handplockade, EJ gjort | ~15 inkl. Riverside, EJ gjort | 9 godkända | 17 godkända |
| Maskinläsbara event hos ställen | ~0 (stickprov 2 av 40 totalt har JSON-LD Event, 2 iCal) | | | |
| Hygienbetyg (öppna data) | SD Dept of Health: ej utrett | Riverside County: ej utrett | Colorado/Broomfield County: ej utrett | FSA/FHIS: öppet API, ej utrett |

Vad som SAKNAS (ärligt): maskinläsbar happy hour (0 av 40), maskinläsbara återkommande kvällar (löptext -> Haiku-extraktion är enda vägen), eventsidor hos ställena (stickprovet hämtade bara startsidor), Facebook-bara ställen (troligen majoriteten av små barer i Brookings och Moreno, ingen skrapning), US-biljett-API utöver Ticketmaster, Skiddle (kräver skriftligt godkännande för kommersiell användning, ej begärt), Dice/SeatGeek/Songkick (villkor ej verifierade, räknas som nej). Eventbrite och Bandsintown utesluts (stängt/partnerskap).
Kaffe: OSM har outdoor_seating/internet_access på Glasgow 66/51 av 473 kaféer, Broomfield 14/15 av 64, Brookings 1/2 av 10, Moreno 0/2 av 14. Räcker som navsida bara i Glasgow och Broomfield; Brookings kräver handkontrollerade rader (källa = kaféets egen sida).

## 2. Sidstruktur
Roller (oförändrade): /today = dagens överblick med kort Tonight-teaser; /tonight = ikväll; /this-weekend = fre-sön; /events och /whats-on = hela listan. Inga datum-arkiv, en URL per vy.
Nytt (T5): `/food-drink/` som nav med tre fråge-sidor:
- /food-drink/happy-hour/ -- "När är det happy hour och vad ingår?"
- /food-drink/open-late/ -- "Var kan jag äta efter 22?" (återanvänder lib/osm-open-late.ts, ingen ny datakälla)
- /food-drink/coffee/ -- "Vart går jag för kaffe nära campus/centrum, och går det att sitta och jobba?"
Navigation (standarden i .claude/spec-section-nav.md, config `nav.tabs`/`nav.groups` per stad): sidorna läggs i All-panelens grupp "Now"/"Eat & drink", inte som flik i svepraden; bygget faller om ett id står i `tabs` men saknas i `groups`, listas två gånger eller pekar på en avstängd rutt. Moreno hålls kvar i All-panelen tills tröskeln nås (befintligt beslut). Varje sida breadcrumb Home > Food & drink > X, intern länk från /tonight och /today, med i llms.txt först när sidan är indexerbar (GEO-specen punkt 1).
Indexering: bara navsidorna indexeras. Ställessidor och enskilda event förblir noindex tills de har eget innehåll. Tröskel per navsida och stad: minst 10 aktuella poster i minst 3 grupper (happy hour: grupper = dag/typ av ställe; coffee: nära campus, centrum, uteservering/wifi); under tröskeln noindex och ur sitemap, samma verdict-mekanism som evening-verdict. Byggspärren (max 30 nya indexerbara sidor per deploy) gäller.

## 3. Innehållsregler
- Riktig data som hjälper en invånare. Varje rad bär ställets namn, tid/dag, adress, "checked <datum>" och källänk till ställets egen sida. Bild bara om vi har rätt att använda den; annars ingen (aldrig hotlänk).
- Egna korta sammanfattningar är ok (omformuleringskontrollen gäller, aldrig kopierad text), inga omdömen om mat, stämning eller kvalitet. Inget "best" som inte går att belägga: rubrik efter vad sidan visar ("Coffee shops near SDSU: hours, outdoor seating, wifi"), sökordet "best coffee" får landa här utan att sidan påstår något är bäst.
- Ingen generisk AI-innehållsrad (recept, recensioner, krönikor). Haiku används bara för (1) extraktion ur ställets egen sida till strukturerade regler och (2) /this-weekend-ingressen (max 3 meningar, inga tider, inga omdömen).
- Färskhet: daterade event tas bort om de inte setts i källan på 7 dagar; återkommande regler kontrolleras månadsvis och tas bort efter 35 dagar utan bekräftelse; navsideraderna (happy hour, coffee) tas bort efter 30 dagar utan bekräftelse. Rad visas aldrig "med gammalt datum".
- Sidans svar ska stå i rå-HTML (GEO punkt 2): bygget innehåller en fullständig, något gammal lista; webbläsaren får bara dölja avslutat och räkna om.
- Mervärde utöver listan: filter efter fråga (free, late, all ages), kvällens väder/varningar, "Getting home" i Glasgow (SPT/ScotRail ur officiella källor).

## 4. Fel att undvika (varje fel som hittas får QA-kontroll i qa/checks.json med born_from + regressionsfixtur, regel 12)
1. Tidszon/datum: "ikväll" räknas efter STADENS klocka (America/Chicago, America/Denver, America/Los_Angeles, Europe/London), inte byggserverns UTC. Event som startar 19:00 lokal tid ligger nästa UTC-dag. Test med falsk klocka runt midnatt, runt DST-byten (US 1 nov passerad, UK 25 okt passerad, nästa 8 mar/29 mar) och för Moreno (PST) vs Brookings (CST) samma ögonblick. Heldagsevent räknas inte som kväll (befintlig regel, lib/local-day.ts).
2. Upprepade event: en serie (quiz varje tisdag) är EN regel med dagar, inte 26 nästan identiska sidor eller rader. Dedup titel+plats+start (finns); web.duplicate-content (8-ords-shingles) körs på de nya sidtyperna före indexering. GFT: en rad per film och kväll med alla tider.
3. Bilder: inga hotlinkade bilder; egna eller licensierade kategoribilder (befintlig kategoripool) eller ingen bild.
4. Tider och adresser: extraktionen valideras mot sidans egen text (finns i validatorn); tid utan AM/PM eller utan tidszon förkastas; adress måste finnas i ställets sida eller OSM; ställe med flyttad/kapad domän (13th Note, Front Range Brewing) flaggas och visas inte. Sluttid efter midnatt hanteras som nästa dag (open late).
5. Brookings-specifikt: visa inte Sioux Falls-event som "i Brookings" (körtid/avstånd synligt, befintligt beslut för rader utanför staden).
6. Påstå inte mer än datan: "Open late" kommer från OSM och ska kontrolleras med stället (texten finns).
7. Fel antal i sammanfattningsrader efter att webbläsaren dolt avslutat (känd klass, QA-kontroll finns).

## 5. Kostnad (uppskattning, inte mätt)
Haiku 4.5, ca 1 USD in / 5 USD ut per miljon tokens (verifiera mot repots usage-logg före beslut).
- Registerextraktion veckovis: ~56 ställen (Glasgow 17, Broomfield 9, Brookings ~15, Moreno ~15) x ~6 000 tokens in + ~800 ut x 4,3 veckor = ~1,4 M in + 0,2 M ut = ca 2-3 USD/mån.
- Happy hour/kaffe-extraktion (menysidor, månadsvis, ~50 ställen): ca 0,5 USD/mån.
- /this-weekend-ingress: 4 städer x ~9 helger/mån x ~1 500 tokens: under 0,2 USD/mån.
- Total ca 3-4 USD/mån. OSM (Overpass) och Ticketmaster är gratis inom nuvarande gränser. Inget nytt betalt API.
- Actions: registerjobbet ~10 min/vecka (~45 min/mån) + extra byggen när navsidornas tröskel växlar. VARNING: repot låg på ~5 000 av 2 000 gratis minuter/mån (.claude/specs/actions-minutes-plan.md); registerjobbet får inte läggas till innan den planen är genomförd eller ägaren godkänt kostnaden.

## 6. Ordning och skäl
1. Glasgow först för det som saknas (T5-navsidorna): mest data redan (~465 OSM-ställen, 114 med öppettider, 17 godkända registerställen, FSA-hygiendata), tröskeln nås, noindex är borta sedan lanseringen. Snabbast att verifiera att modellen fungerar.
2. Broomfield: open-late och coffee går att bygga ur OSM (34 ställen, 14 uteservering); registret är litet (9). Tröskeln för happy hour osäker.
3. Brookings: det är här AdSense-ansökan avgörs (mitten av november, brookings-adsense-prep.md). Ärlig bedömning: /tonight kommer inte nå tröskeln (~1 TM-event/kväll) och ska förbli noindex. Det som kan göra Brookings starkare på två veckor är inte fler kvällsevent utan handkontrollerade navsidor för SDSU-stad: /food-drink/coffee/ (kaféer nära campus, öppettider, wifi, uteservering) och /food-drink/open-late/, ~15 ställen kontrollerade mot ställenas egna sidor, plus /this-weekend som fungerar med bibliotek, kammare, SDSU och Sioux Falls med tydligt avstånd. Det kräver ägarens godkännande av ställelistan (steg 4 nedan) och manuell källkontroll, inte skrapning. Rekommenderas FÖRE Glasgow-bygget om AdSense-datumet är fast, annars efter.
4. Moreno Valley sist: nästan inget i OSM, tröskeln borderline; registret (Riverside) och stadens egna event bär. Ingen ny indexering utan tröskeln.
Varje steg: lokal commit, tester för berörd fil, ställelistan visas för ägaren före extraktion, migration/live-skrivning = ägarens ja (regel 7), en push per omgång efter ja, QA Pass + Q3 på nya sidtyper före indexering.

## 7. Frågor till ägaren
1. Brookings före eller efter Glasgow? Om AdSense-ansökan är fast i mitten av november rekommenderar jag Brookings först med bara coffee + open-late + helg (ingen /tonight-indexering). Är datumet fast?
2. Får jag ta fram en handplockad Brookings-lista på ~15 ställen (kaféer nära SDSU, öppet sent, bryggerier) för ditt godkännande, med källa = ställets egen sida? Du ser listan före varje hämtning.
3. Ska happy hour-sidan finnas överhuvudtaget i Brookings och Moreno, där 0 av 40 sidor publicerar det maskinläsbart och troligen bara en handfull i löptext? Förslag: bygg den bara i städer som når tröskeln, annars ingen sida.
4. Hygienbetyg (Glasgow FSA/FHIS, US-länens inspektioner): får jag utreda öppna data som ett fjärde filter, eller hellre avstå (risk: fel koppling ställe-inspektion)?
5. Actions-minuterna ligger över gränsen. Ska registerjobbet vänta tills minutplanen är genomförd, eller godkänner du merkostnaden?

## 8. Ägarens svar 2026-11-04 (BESLUT)
1. Glasgow har prioritet för kvällslagret. Brookings får bara de handkontrollerade kaffe- och open-late-sidorna kring SDSU inför AdSense. Inget mer Brookings-specifikt arbete.
2. Ja till en lista på ca 15 Brookings-ställen, godkänns av ägaren före publicering, källa per ställe: se .claude/specs/brookings-places-proposal.md.
3. Nej till happy hour-sida i städer under tröskeln: bygg inte där, eller håll noindex och olänkad.
4. Hygienbetyg: bara utredning, ingen kod. FHIS för Glasgow först; US-län parkeras. Utredning nedan.
5. Registerjobbet väntar på Actions-minutplanen. Inga nya schemalagda workflows tills dess.

### FHIS-utredning (Glasgow, läst 2026-11-04, ingen kod)
- Källa: FSA:s öppna API (api.ratings.food.gov.uk) täcker även Skottland (FHIS). Kräver headern x-api-version: 2, ingen nyckel, ingen registrering ("kan ändras"). Rate limit och licenstext står inte på hjälpsidan: licensen (troligen Open Government Licence) och kravet på attribution/bildregler för betygsmärken MÅSTE verifieras före publicering.
- Glasgow City = LocalAuthorityId 213, 6 686 ställen (14 sidor à 500). Typ-filter fungerar (Pub/bar/nightclub = businessTypeId 7843, 361 st). Fält: FHRSID, BusinessName, BusinessType, RatingValue, RatingDate, SchemeType, PostCode, AddressLine1 (ofta tom), geocode (lat/long; 495 av 500 i provet), NewRatingPending.
- Skotska betyg är bara "Pass", "Improvement Required" (m.fl. statusvärden) och i stickprovet "Pass and Eat Safe"; inga poäng. 494 av 500 i provet var "Pass", så ett filter skiljer nästan inget åt. Många betyg är gamla (2019).
- Risker: koppling ställe -> inspektion saknar gemensamt id (matchning på namn + postnummer/koordinat; fel koppling ger ett felaktigt påstående om ett namngivet ställe), AddressLine1 tom, kedjor och flera ställen på samma adress, ett gammalt betyg visas som aktuellt.
- Rekommendation: litet värde som filter ("bara Pass" separerar inget). Om det byggs: visa bara betyg + datum + länk till FSS-posten, bara vid säker matchning (FHRSID bekräftat manuellt för registrets 17 Glasgow-ställen), aldrig som ranking. Beslutet är ägarens; ingenting byggt.

### Uppdatering 2026-11-04 (senare, ägarens beslut)
- AdSense-målet byts från Brookings till Broomfield (ca 300 impressions/dag på civila uppslagsfrågor; Brookings nästan noll). Punkt 1 ovan ("Brookings bara kaffe/open-late inför AdSense") är därmed ersatt: ingen Brookings-AdSense-vinkel. Granskning av Broomfield: .claude/specs/broomfield-adsense-audit.md (bara rapport).
- Punkt 2 (Brookings-lista): Parkerad – under tröskel, noindex, ger inget för AdSense. Tas upp igen om Brookings får fler källor. Inget hämtas. brookings-places-proposal.md behålls.
- Punkt 4 (FHIS/hygienbetyg): avfärdad. Gå inte vidare. Utredningen ovan behålls bara som dokumentation.
