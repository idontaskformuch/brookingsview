# Tonight & weekend layer, alla städer

Ägaren 2026-10-27 (ersätter tidigare weekend-layer-spec; ingen äldre fil fanns i repot). Status: spec sparad, INGET byggt. Hög prio, efter Glasgow-lansering och Brookings AdSense-fixar.

Mål: sajten svarar på "vad ska vi göra ikväll?" och "vad gör vi i helgen?". Inte en katalog. Redaktionell grundregel och "varje uppgift har ett hem" gäller. Inga nyhetsbrev.

## Fas T1: Källor bortom Ticketmaster
- Ställesregister per stad: OpenStreetMap (amenity pub/bar/nightclub/restaurant/cafe, music venues) med website-tagg, ODbL-attribution.
- Veckovis upptäckt: kontrollera varje ställessida för schema.org Event (JSON-LD), iCal eller RSS. Robots och villkor först, ViewMediaBot, högst en hämtning per ställe och dygn.
- Biljettplattformar med öppet API (t.ex. Skiddle för UK): utred tillgång och villkor, rapportera innan något byggs. Ingen kringgång av botskydd. Facebook/Instagram används inte.
- Återkommande kvällar (quiz, livemusik, open mic) från löptext på ställets sida: AI-extraktion (Haiku) till regel + källa, kontrolleras igen månadsvis. Valideringsgaten gäller.
- Bara titel, tid, pris, åldersgräns, plats och länk. Egen kort sammanfattning genom omformuleringskontrollen, aldrig kopierad text.

## Fas T2: /tonight/ per stad
- Indexerbar. Svarar på "vad gör vi ikväll?".
- Beräknas i webbläsaren efter stadens klocka: det som börjar efter nu eller pågår, fram till sent i kväll. Efter cirka kl. 23 visas "Tomorrow night".
- Grupper: Live music, Comedy & shows, Quiz & pub nights, Clubs & late, Sport tonight, Free tonight. Tomma grupper utelämnas.
- "Open late" ur OSM opening_hours, med text om att tiderna kommer från OpenStreetMap och bör kontrolleras med stället.
- Etiketter från källdata: Free, 18+, All ages.
- Highlights överst (3 kort), kompakta rader under, länk till eventsidan.

## Fas T3: /this-weekend/ per stad
- Samma data och komponenter som /tonight, för fre-sön. Grupper: Nights out & live music, Sport, Markets & food, Family, Free.
- Kort AI-ingress (Haiku, max 3 meningar, inga tider, inga omdömen).

## Fas T4: Glasgow What's On
- Slå på hasWhatsOn (Ticketmaster GB), kapacitetsnivåer för Glasgows lokaler. Föreslå radie, fråga ägaren.

## Fas T5: Mat och dryck som data
- /food-drink/ med verifierbara filter: open late tonight, live music this weekend, new in town, hygienbetyg (Glasgow FSA/FHIS; US-länens inspektioner där datan är öppen).
- Inga AI-omdömen om mat, stämning eller kvalitet. Ställessidor bara med eget innehåll, annars noindex.

## T1-utredning (omgång 2a, ägaren 2026-10-28): ren utredning, inget skrivande mot live-DB, ingen kod utöver testskript
Per stad (Glasgow, Brookings, Moreno Valley, Broomfield) rapporteras, ingenting byggs:
1. OpenStreetMap: antal pubar, barer, musiklokaler, nattklubbar (och teatrar/evenemangslokaler), hur många har webbadress och öppettider.
2. Stickprov på 10 ställen per stad: har sidan schema.org Event (JSON-LD), iCal eller RSS? Robots och villkor (ViewMediaBot, högst en hämtning per ställe och dygn).
3. Biljettplattformar med öppet API (Skiddle m.fl. för UK; US-motsvarigheter): villkor, nyckelkrav, kostnad. Inga nya betalda API:er.
4. Realistiskt antal aktuella kvällsevent per stad och vecka (mät mot vår egen events-tabell + Ticketmaster).
5. TILLÄGG: leta särskilt efter ÅTERKOMMANDE KVÄLLAR (quiz, livemusik, open mic, sport på storbild) och vilka ställen som publicerar dem maskinläsbart (JSON-LD/iCal/RSS) respektive bara som löptext.
6. TILLÄGG: föreslå ett KURATERAT REGISTER på 15-30 ställen per stad (inte hela OSM), med källa och hur ofta varje ställe uppdaterar.
7. TILLÄGG: ange per stad vilken RADIE (miles/körtid) som ger tillräckligt innehåll: Brookings -> Sioux Falls, Broomfield -> Boulder/Denver, Moreno Valley -> Riverside/Temecula.
8. TILLÄGG: bedöm hur stor ANDEL av ställena som bara använder Facebook/Instagram (ingen skrapning där, se Fas T1) och föreslå om en "Add your event"-sida med moderering behövs som komplement. Bara förslag, inget byggs.
9. Slutsats: vilka städer når tröskeln (minst 10 aktuella poster i minst 3 grupper) för /tonight. Rapportera, bygg inget.
Arbetsmaterial 2026-10-28 (påbörjat, ej klart): Overpass-skript i sessionens scratchpad (t1_osm.py; overpass-api.de svarade 502 vid första försöket, försök igen/annan instans).

## Roller (inga dubbletter)
/tonight = ikväll, /this-weekend = helgen, /events = hela listan, /today = dagens överblick med kort Tonight-teaser och länk.

## Regler
- Allt nytt noindex tills det har eget innehåll.
- Inga nya betalda API:er.
- QA-regler för de nya sidtyperna och Q3 innan de indexeras.

## Skydd mot low value content (tillägg 2026-10-27)
1. Indexera bara navsidor: /tonight, /this-weekend, /food-drink. Event- och ställessidor noindex tills de har eget innehåll. Inga arkivsidor per datum, en URL per vy.
2. Tröskel per stad för indexering: minst 10 aktuella poster i minst 3 grupper, annars noindex för den staden (config-styrt, så Brookings kan ligga kvar med noindex).
3. Mervärde utöver listorna: filter efter fråga (free, late, all ages), kvällens väder och varningar, "Getting home" (sista tunnelbana/tåg i Glasgow, ur officiella källor).
4. Färskhet: "checked today" + källänk per rad. Poster som inte bekräftats på 7 dagar tas bort.
5. Ingen AI-text på /tonight. Ingressen på /this-weekend max 3 meningar, faktabaserad.
6. Byggspärr: deploy som lägger till fler än 30 nya indexerbara sidor fallerar, och kräver uttryckligt ja.
7. Före indexering: web.duplicate-content och Q3 på de nya sidtyperna.

## Senare, bygg inte
Sponsrade platser (märkta, rel="sponsored", aldrig i redaktionella listor), Best of-röstning, boende/affiliate.
