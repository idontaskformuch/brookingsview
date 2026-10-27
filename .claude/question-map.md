# Frågekarta: vad invånarna frågar om i vardagen (ägaren 2026-10-27, rapport, inget byggt)

Syfte: se vilka vardagsfrågor varje sajt svarar på, vilka som bara delvis besvaras och vilka som saknas, och om en officiell källa finns, så att nästa bygge väljs efter invånarnas behov (redaktionella grundregeln).

## Så är kartan gjord (läs detta först)
- Status per stad: **✔ besvaras** (egen sida/sektion med data för staden), **◐ delvis** (finns men tunn, bara länk, eller bara en del av frågan), **✘ saknas**, **n/a** gäller inte staden.
- Källa: **k** = en officiell källa är känd (stadens/länets/myndighetens egen sida eller öppna data), **–** = ingen känd/ej undersökt. "k" betyder INTE att den är hämtbar eller att villkoren är kollade; det görs per källa före bygge.
- Underlag: sektionslistan per stad (site/src/pages, site-config-flaggor, sidlistorna i reports/metadata-audit-*.csv från sept) och kodens städergater (t.ex. trash-recycling, how-city-council-works och game-day finns BARA för Brookings). Jag har inte läst varje sida i skarp version; en cell är en bedömning, inte en mätning. Fråga om en cell ser fel ut så rättar jag den.
- **Sökvolym: tom överallt.** Det finns ingen Search Console-export i repot (sökt efter csv/json med impressions/Queries; inga träffar). Lägg in exporten (Prestanda > Sökfrågor, 3 månader, per sajt) i `.claude/gsc/<stad>-queries.csv` så fyller jag kolumnen och gör om toppen nedan. Tills dess bygger rangordningen på bedömd vardagsfrekvens.
- Glasgow: sajten är noindex och har inga visningar än, så sökvolym finns inte där förrän efter lansering.
- B = Brookings SD, M = Moreno Valley CA, C = Broomfield CO, G = Glasgow.

## Kartan (50 frågor)

| # | Fråga | B | M | C | G | Anmärkning |
|---|-------|---|---|---|---|------------|
| **Sophämtning och sopor** | | | | | | |
| 1 | Vilken dag hämtas mina sopor/återvinning? | ✔k | ✘k | ✘k | ✘k | Bara Brookings (/trash-recycling/). Övriga: hämtare/kommun publicerar scheman |
| 2 | Hur gör jag med grovsopor/julgran/farligt avfall? | ◐k | ✘k | ◐k | ✘k | Broomfield har recycling-anläggning i facilities |
| 3 | Är hämtningen inställd/försenad (helg, väder)? | ◐k | ✘k | ✘k | ✘k | |
| **Parkering och gator** | | | | | | |
| 4 | Var får jag parkera / finns det avgift? | ✘k | ✘k | ✘k | ✘k | |
| 5 | Parkeringsförbud vid snö (snönödläge)? | ✘k | n/a | ✘k | ✘k | Brookings vinterguide planerad (AdSense-spec) |
| 6 | När plogas min gata, vem skottar trottoaren? | ✘k | n/a | ✘k | ✘k | |
| 7 | Vilka vägar är avstängda/har arbeten idag? | ✔k | ✔k | ✔k | ✘k | Glasgow: Traffic Scotland DATEX-ansökan ej klar (trafiksektionen avstängd) |
| 8 | Hur mycket trafik/olyckor är det på vägen nu? | ✔k | ✔k | ✔k | ✘k | |
| **Skolor** | | | | | | |
| 9 | Är skolan stängd/försenad idag? | ✔k | ✔k | ◐k | ✘k | Glasgow saknar källa; raden "Schools open" tas bort där |
| 10 | Skolans/distriktets kalender, lov, terminsdatum? | ◐k | ◐k | ◐k | ✘k | |
| 11 | Vad beslutar skolstyrelsen? | ✔k | ◐k | ✔k | n/a | |
| **Kollektivtrafik och transport** | | | | | | |
| 12 | När går buss/tåg/tunnelbana, sista avgång? | ✘k | ✘k | ✘k | ✘k | Glasgow: "Getting home" (SPT/First) i weekend-layer-specen |
| 13 | Var är närmaste station/hållplats? | ✘k | ✘k | ✘k | ✘k | |
| 14 | Hur tar jag mig till flyg/lokalt? | ✘– | ✘– | ✘– | ✘– | |
| **Vård och hälsa** | | | | | | |
| 15 | Var ligger närmaste akutmottagning/vårdcentral/apotek? | ✘k | ✘k | ✘k | ✘k | facilities har kategorin medical men ingen vårddata |
| 16 | Vem ringer jag när det inte är akut? | ✘k | ✘k | ✘k | ✘k | |
| 17 | Hur är luften idag (rök/ozon/pollen)? | ✘k | ✘k | ✘k | ✘k | public-safety-specen (AirNow m.fl.), Moreno/Broomfield först |
| **Bibliotek och allmänna platser** | | | | | | |
| 18 | När öppnar/stänger biblioteket? | ✔k | ✔k | ✔k | ✔k | Öppet-nu-rad från strukturerade tider |
| 19 | Vad händer på biblioteket (barntid, kurser)? | ✔k | ✔k | ◐k | ✔k | |
| 20 | Vilka parker/lekplatser finns och vad finns där? | ◐k | ◐k | ◐k | ✘k | Parker via OSM planerat (Brookings-specen) |
| 21 | Var finns offentlig toalett/vattenfontän/wifi? | ✘k | ✘k | ✘k | ✘k | |
| 22 | När har kommunhuset/postkontoret öppet? | ✔k | ✔k | ✔k | ◐k | |
| **Event och helg** | | | | | | |
| 23 | Vad händer i helgen? | ✔k | ✔k | ◐k | ✔k | Broomfield: tunnare eventkälla |
| 24 | Vad kan vi göra ikväll? | ◐k | ◐k | ◐k | ◐k | /tonight planerad (weekend-layer) |
| 25 | Vad gör vi med barnen? | ◐k | ◐k | ◐k | ◐k | Finns som filter/tema, ingen egen vy |
| 26 | Vad är gratis? | ◐k | ◐k | ◐k | ◐k | Etikett finns i källdata |
| 27 | Konserter och biljetter nära mig? | ✔k | ✔k | ✔k | ✘k | Glasgow: What's On/Ticketmaster GB avstängt (T4, väntar på radie) |
| 28 | Matchdag: när, var, vad stängs? | ✔k | ◐k | ✘k | ✘k | Brookings /game-day/. Glasgow: matchdagsguide i backlog |
| 29 | Vad är öppet sent/på helgdag? | ◐k | ◐k | ✘k | ✘k | Thanksgiving-sida finns för de tre US-sajterna |
| 30 | Marknader, mässor, loppisar? | ◐k | ◐k | ◐k | ◐k | |
| **Väder och säkerhet** | | | | | | |
| 31 | Hur blir vädret idag/imorgon/veckan? | ✔k | ✔k | ✔k | ✔k | |
| 32 | Finns det vädervarning, vad ska jag göra? | ✔k | ✔k | ✔k | ✔k | Glasgow: Met Office-ruta; SEPA bara länk |
| 33 | Översvämningsrisk i mitt område? | ◐k | ◐k | ◐k | ◐k | Brookings har flodmätare i källor; Glasgow SEPA-länk |
| 34 | Brand/rök/evakuering i närheten? | ✘k | ✘k | ✘k | ✘k | public-safety-specen; Moreno först (brandsäsong) |
| 35 | Värmevarning/kylcentra, skydd? | ✘k | ✔k | ✘k | ✘k | Moreno har HeatAdvisory |
| 36 | Vad gör jag vid strömavbrott/vattenstopp? | ✘k | ✘k | ✘k | ✘k | |
| **Flytt och nyinflyttad** | | | | | | |
| 37 | Vad ska jag ordna när jag flyttar hit (el, vatten, sopor, röstregistrering)? | ◐k | ◐k | ◐k | ✘k | /new-in-town finns men är nyhetsflöde; "New to Brookings"-guide planerad |
| 38 | Hur registrerar jag mig för att rösta, var röstar jag? | ✔k | ✔k | ✔k | n/a | /vote |
| 39 | Vilka valresultat och när? | ✔k | ◐k | ✔k | n/a | /election-results (Moreno: bara länk) |
| 40 | Vilka skolor hör till min adress? | ✘k | ✘k | ✘k | ✘k | |
| **Jobb** | | | | | | |
| 41 | Vilka jobb finns lokalt? | ✔k | ✔k | ✔k | ✘k | Glasgow: jobs avstängd |
| 42 | Vilka arbetsgivare finns och hur är de? | ◐k | ✔k | ◐k | ✘k | Moreno: Worker Pulse (kommentarer) |
| **Bostad** | | | | | | |
| 43 | Vad kostar/såldes bostäder i mitt område? | ✘k | ✔k | ✘k | ✘k | Bara Moreno (rivco-data) |
| 44 | Behöver jag tillstånd för bygge/staket/skylt? | ◐k | ◐k | ◐k | ✘k | Permit-källor finns i config, ingen guide |
| 45 | Vad byggs i närheten (planärenden)? | ✔k | ✔k | ✔k | ✔k | Via kommunmöten/agendor |
| **Kommunen och avgifter** | | | | | | |
| 46 | Vad beslutade kommunfullmäktige/nämnden, när är nästa möte? | ✔k | ✔k | ✔k | ✔k | /city-hall |
| 47 | Hur fungerar kommunfullmäktige, hur yttrar jag mig? | ✔k | ✘k | ✘k | ◐k | Bara Brookings (/how-city-council-works/); Glasgow: agendalänk på mötessidor |
| 48 | Vad kostar vatten, avfall, fastighetsskatt, avgifter? | ✘k | ✘k | ✘k | ✘k | |
| 49 | Hur betalar/anmäler/klagar jag (felanmälan, hål i vägen)? | ✘k | ✘k | ✘k | ✘k | |
| 50 | Vilka tjänster/telefon har kommunen, vem ringer jag? | ◐k | ◐k | ◐k | ◐k | facilities-sidor ger telefon för ett fåtal ställen |

Summering (✔ / ◐ / ✘ av 50, n/a ej inräknat): se nedan, räknat från tabellen.

| Stad | ✔ | ◐ | ✘ | n/a |
|------|---|---|---|-----|
| Brookings | 19 | 14 | 17 | 0 |
| Moreno Valley | 17 | 14 | 17 | 2 |
| Broomfield | 13 | 15 | 22 | 0 |
| Glasgow | 7 | 8 | 32 | 3 |

(Siffrorna är räknade ur tabellen ovan. Är en cell fel ändras totalen med den.)

## Förslag: topp 10 per stad
Rangordning = hur ofta en invånare behöver svaret x hur illa det besvaras idag x om en officiell, hämtbar källa finns. Sökvolym ersätter gissningen i den första faktorn när exporten finns.

**Brookings** (AdSense-ansökan mitten av november, vinter på väg)
1. Snöröjning, snönödläge, parkeringsförbud, trottoarer (fråga 5, 6): vinterguiden först, redan beslutad.
2. Flytt: el/vatten, sopor, röstregistrering, skolor, tillstånd (37, 40).
3. Avgifter och fastighetsskatt (48).
4. Felanmälan/kontakt kommunen (49, 50).
5. Närmaste vård/akut/apotek (15, 16).
6. Parker och lekplatser (20): OSM.
7. Parkering (4).
8. Grovsopor/farligt avfall/julgran (2, 3).
9. Tillstånd för bygge/staket (44).
10. Skolkalender/lov (10).

**Moreno Valley** (brandsäsong)
1. Brand, rök, evakuering (34): CAL FIRE.
2. Luftkvalitet (17): AirNow.
3. Sophämtning (1, 2, 3).
4. Strömavbrott/vattenstopp (36).
5. Närmaste vård/akut (15).
6. Parkering (4).
7. Hur fungerar kommunfullmäktige och hur yttrar jag mig (47).
8. Flytt (37).
9. Avgifter (48).
10. Skolor efter adress, skolkalender (40, 10).

**Broomfield**
1. Sophämtning (1, 2, 3): inte byggt, källa finns.
2. Brand/rök och luftkvalitet (34, 17): NIFC/WFIGS + AirNow.
3. Snöröjning och parkeringsförbud (5, 6).
4. Skolstängning fullt ut, båda distrikten (9).
5. Flytt (37).
6. Kommunfullmäktige/hur yttrar jag mig (47).
7. Parker (20).
8. Vård (15).
9. Avgifter (48).
10. Bostad/marknad (43) och tillstånd (44).

**Glasgow** (inför lansering)
1. Hemresa: sista tunnelbana/tåg/buss (12): "Getting home".
2. Sophämtning/återvinning, bin days (1): Glasgow City Council.
3. Parkering och Low Emission Zone (4).
4. Avstängda vägar/trafik (7, 8): Traffic Scotland när ansökan är klar.
5. Matchdag Celtic Park/Ibrox (28): backlog.
6. Vad kan vi göra ikväll (24) och Ticketmaster What's On (27): T4/T2.
7. Skolstängning (9): kommunens sida.
8. Vård utanför kontorstid (15, 16): NHS Inform / NHS 24.
9. Flytt (37): bostad, council tax, registrering.
10. Brand/vägavstängning från Police Scotland och SFRS (34): public-safety-specen.

## Nästa steg (kräver ägarens ja, inget byggs nu)
- Lägg in Search Console-exporten, så fylls sökvolymen och toppen räknas om.
- Välj vilka topp-10-punkter som får spec. Redaktionella grundregeln: varje ny sida anger vilken konkret fråga den besvarar (kolumnen "Fråga" ovan är det formuleringsunderlaget).
- Källor som finns ("k") ska fortfarande få robots/villkorskontroll före bygge.
