# Broomfield: AdSense-granskning (2026-11-04, ENDAST RAPPORT, ingen kod ändrad, inget pushat)

Beslut (ägaren 2026-11-04): AdSense-målet är Broomfield, inte Brookings (ca 300 impressions/dag på civila uppslagsfrågor mot nästan noll i Brookings).

Underlag: lokalt bygge av broomfield_co 2026-11-04 (HTML + sitemap-0.xml), läsning av live-databasen (bara SELECT), configs/broomfield_co.json, site-config, sidtexterna i bygget. Ordantal = synlig text i main exklusive skript/stil/nav, räknad med eget skript. Bygget använder en annan räkneregel (egna ord, noindex under 250), så siffrorna är jämförbara sinsemellan men inte identiska med byggets.

## VIKTIGT: Search Console-exporten saknas
`.claude/gsc/` finns inte i repot (ingen CSV/JSON med frågor eller impressions någonstans; samma sak noterade .claude/question-map.md 2026-10-27). Punkt 2 kan därför INTE göras mot riktiga frågor, och jag har inte hittat på några. Lägg exporten i `.claude/gsc/broomfield-queries.csv` (Prestanda > Sökfrågor, 3 månader, med klick, visningar och position, helst även Sidor-exporten) så gör jag om punkt 2 med de 20 största frågorna.

## 1. Indexerbara sidor (71 i sitemap av 1 043 byggda; 972 är noindex; 0 sidor är både noindex och i sitemap)
| Grupp | Antal | Ord (min / median / max) | Ursprung | Anmärkning |
|---|---|---|---|---|
| / (startsida) | 1 | 573 | eget + aggregerat | ok |
| /facilities/ detaljsidor | 46 | 71 / 93 / 640 | eget urval (handkurerat från broomfield.org) men mall-text | 26 av 46 under 100 ord |
| /city-hall/ (+archive, projects, 1 projektsida) | 4 | 77 / 339 / 1 222 | aggregerat: AI-sammanfattning av AgendaLink-agendor | /city-hall/projects/ 77 ord; projektsidan "Palisade Park Chipotle" 257 |
| /whats-on/ | 1 | 5 875 | aggregerat: Ticketmaster-lista (850 detaljsidor är noindex) | stor men ren listdata, ingen förklaring |
| /tonight/, /this-weekend/ | 2 | 661, 966 | aggregerat: Ticketmaster + OSM + register | se punkt 4 |
| /today/ | 1 | 170 | aggregerat (väder, event) | tunn |
| /weather/, /safety/, /traffic/ | 3 | 343, 302, 155 | aggregerat från NWS/CDOT/NIFC | /traffic/ tunn |
| /vote/, /election-results/, /thanksgiving/ | 3 | 497, 138, 402 | eget (guider; resultat laddas i webbläsaren) | /election-results/ 138 ord i rå-HTML, avsett |
| /this-week/2026-w37/ | 1 | 136 | aggregerat, GAMMALT (7-13 sep) | indexerbar veckosida från september, ska vara noindex |
| Förtroendesidor: about, contact, privacy, cookies, terms, corrections, editorial-policy, how-we-gather-this, advertising | 9 | 61-606 | DELAD MALL med de andra sajterna (stadsnamn och källistor byts) | /corrections/ 61 och /contact/ 107 är tunna |

Skrapat: inget indexerbart är kopierad text; sammanfattningarna är AI-omskrivna med källänk. Delat med andra städer: de 9 förtroendesidorna och facility-mallen (samma meningar, annan data).

### Rester av det borttagna AI-innehållsspåret
- Databasen har för Broomfield fortfarande PUBLICERAT: 7 culture_essay (av 10), 5 vetenskap_kronika, 5 vardagsmiddag (recept), 5 media_recension, 5 kvick_essa och 3 editorial (av 4). I bygget finns de som 34 sidor under /s/ (culture-essay 10, science-column 5, review 5, recipe 5, quick-essay 5, editorial 4) plus sektionssidorna /recipes/, /reviews/, /columns/, /editorials/. ALLA är noindex, ingen är i sitemap, och jag hittade inga interna länkar till dem från startsidan. De är ändå publika URL:er som en AdSense-granskare eller en bot kan nå: ca 600-760 ord vardera, AI-skrivna, utan koppling till Broomfield.
- Textrester som är synliga och indexerade: /how-we-gather-this/ har en hel sektion "Reviews, recipes, editorials, and columns" som säger att sajten publicerar AI-skrivna recensioner, recept, ledare och krönikor. Spåret stängdes 2026-10-07, så texten beskriver något som inte längre görs. llms.txt har samma påstående (raden "Reviews, recipes, editorials, and columns are AI-written ..."). /advertising/ säger "AI-generated content on this site is always labeled as such."
- Workplace Watch (9 digest-sidor under /s/ och /workplace-watch/) är noindex via quietSections.

## 2. Fråga -> sida (kan inte göras mot GSC, se ovan)
Det jag kan säga utan export, ur .claude/question-map.md (en BEDÖMNING, inte mätning), för Broomfield:
- Besvaras: fullmäktige (/city-hall/), väder, trafik, röstning, valresultat, anläggningar med adress och telefon.
- Delvis: grovsopor/återvinning (bara anläggningen Broomfield Recycling Center, ingen hämtningskalender), parker (25 av 46 facilities, nästan utan text), helgen (tunn lokal eventkälla).
- Saknas: sophämtning, luft/rök, snöröjning/parkeringsförbud, skolstängning (båda distrikten, källorna är döda ändar), flytt, hur yttrar jag mig i fullmäktige, vård, avgifter, tillstånd.

Direkt svar på facility-sidor (46 platser i places): ADRESS 46, WEBBPLATS 46, TELEFON 27, strukturerade ÖPPETTIDER i hours_structured på bara 3 (place_hours har 86 rader fördelade på 14 platser: bibliotek, rec center, community center, museer, rättsväsende, postkontor, återvinning, polis m.fl.; parker och sjukhus saknar tider), PARKERING 0 (parking_note tom överallt), BESKRIVNING saknas på 30. Det är just "öppettider, adress, telefon, parkering" som en fråga som "broomfield library hours" behöver; biblioteket har tider och telefon men ingen parkeringsuppgift.

## 3. Förtroende
- /about/: stämmer i stort med vad sajten gör (agendor, alerts, väder, trafik; AI-sammanfattning utan granskning per post; delad mjukvara; syskonsajterna Brookings View, Moreno Valley View och Glasgow Loop räknas upp). Beskriver ägaren som en person i Sverige på fritid utanför ett dagsjobb (ägarens val; llms.txt-satsen utelämnar det medvetet).
- /contact/: osant påstående: "Right now the site covers the library, the city and county". Broomfields biblioteksflöde (compass.broomfield.org) är inte aktivt. Formuläret finns.
- siteConfig.sourceBlurb ("gathers public information from the City and County of Broomfield, Adams 12 Five Star Schools, and Boulder Valley School District") återges som reservtext på sajten och i llms.txt. Adams 12 och BVSD är konfirmerade döda ändar (school_alerts enabled:false), så påståendet är osant för skolorna. Min nya llms.txt-sats (lokal commit, ej pushad) återger blurben ordagrant och ärver felet.
- /how-we-gather-this/: källistan genereras ur config: AgendaLink, NWS x2, CDOT/COtrip, Adzuna, Glassdoor/Indeed (aggregerade söksammanfattningar), Vail Resorts, Ticketmaster. Inga rester från andra städer (ingen Brookings-, Moreno- eller Glasgow-text). Jobs, Workplace Watch och Vail är noindex/utanför nav, så listan nämner källor vars innehåll inte är indexerbart; inte fel. Restsektionen om AI-spåret: se punkt 1.
- /privacy/ och /cookies/: konsekventa med varandra (Cloudflare-loggar, GA4 före banner, AdSense bara efter samtycke). Oklart: kontaktformulärets meddelanden sparas i databasen (tabellen contact_messages) men privacy säger bara "om du mejlar oss"; "Worker Pulse comment / shift poll" nämns trots att Workplace Watch är noindex (kontrollera om röstning/kommentarer finns på Broomfield alls); sidan kallar sajten "simple, static" men den har Workers-endpoints (valresultat, kontakt).
- ads.txt: /ads.txt ger 404 på Broomfield (ads.txt.ts serverar bara Moreno Valleys pub-id). Pub-id och kontoupplägg är ägarens; inget är uppfunnet. Posten måste finnas när ansökan görs. Inget AdSense-skript finns i Broomfields HTML (kontrollerat), vilket är rätt före godkännande.
- Multi-site-redovisning: finns på /about/ (data-qa-allow-sibling-sites) och är sann. Den kan ändå läsas som "mallsajt" (jfr Moreno-avslaget "Low value content").
- Moreno Valleys AdSense-omprövning ligger kvar under regeln i minnet (inte begära utan att flagga 4-6-veckorsregeln).

## 4. Kvällslagret
- /tonight (661 ord) och /this-weekend (966 ord) är indexerbara. Verdikt i bygget: "stay" (hysteres), ägarens godkännande ja, median 12,5 poster och 4 grupper (tröskel: minst 10 poster i minst 3 grupper). Tröskeln nås alltså, men i praktiken på Ticketmaster-event 25-40 minuter bort (Marquis, Bellco, Red Rocks, CU Events Center); lokalt bär bara Westminster Brewing (poker) och "Open late"-listan. Svagaste punkten bland de indexerade sidorna: en granskare ser främst en regional konsertlista, även om avståndet står vid varje rad.
- OSM: ögonblicksbild 2026-10-29, radie 8 km, 91 element (alla med opening_hours), 14 pubar/barer/klubbar. "Open late" visar 3-5 ställen per kväll (The Old Man Bar, IHOP, Hofbrau, Lodo's, Mugi Ramen, Hooters).
- Registret: 7 venues, alla status ok, men bara 2 aktiva poster från 1 venue (Westminster Brewing). Bidrar nästan inte.
- Facilities seedade: ja, 46 (5 i augusti, resten 2026-09-10/13), men tunna enligt punkt 2.
- Happy hour byggs inte (beslut). Inga nya kvällssidor behövs för AdSense.

## 5. Evenemang: aktiva källor idag
- events-tabellen för broomfield_co innehåller ENDAST nws_alert (14 rader, 0 framåt i tiden). Ingen riktig lokal eventkälla är aktiv. /events/ är noindex och utanför nav (quietSections).
- Event på sajten kommer från Ticketmaster (What's On, radie 20 miles), registret (1 venue) och OSM (open late). Det är regionala event, inte Broomfield-event.
- Spärrade/avvisade: WebTrac (Cloudflare-block, stannar av), compass.broomfield.org (biblioteket mejlat 2026-10-20, väntar på svar, påminn tidigast 2026-11-03; skrapas inte, robots stänger ute), school_alerts Adams 12 och BVSD (döda ändar).
- .claude/spec-broomfield-events.md (2026-10-20, ej byggd) nämner stadens kalender på broomfield.org (CivicPlus iCal/RSS) som källa 2; jag har inte sett att den prövats.

## 6. Prioriterad fixlista (AdSense-risk först, sedan arbete). Inget är gjort.
| # | Fix | Risk | Arbete | Typ |
|---|---|---|---|---|
| 1 | Ta bort restsektionen om recensioner/recept/ledare/krönikor ur /how-we-gather-this/ och raden i llms.txt; rätta raden i /advertising/ | HÖG (publik text beskriver inaktivt AI-spår) | liten | kod |
| 2 | Ta bort AI-essäerna för Broomfield (34 sidor under /s/ + 4 sektionssidor): kodgate så att de inte byggs + avpublicering i databasen | HÖG (AI-innehåll utan stadskoppling, nåbart) | liten kod + DB-skrivning | DB-skrivning kräver ägarens ja (regel 7); gaten kan ligga i samma deploy |
| 3 | Rätta /contact/ ("the library") och sourceBlurb (skoldistrikten) för Broomfield | HÖG (osann källtext) | liten | kod |
| 4 | thinFacilityMinOwnWords för Broomfield (Glasgow har 25) så ca 26 tunna sidor blir noindex och lämnar sitemap | MEDEL-HÖG (37 % av indexerbara sidor är tunna) | liten, config | kod/config |
| 5 | Passerade veckosidor (/this-week/2026-w37/) noindex | MEDEL | liten | kod |
| 6 | Förstärk viktiga facility-sidor (bibliotek, rec center, sjukhus, återvinning, fullmäktige): beskrivning, tider, parkering från stadens egna sidor | MEDEL (svarar uppslagsfrågor) | stor, handarbete | DB-skrivning, ägarens ja |
| 7 | ads.txt för broomfieldview.com när AdSense-konto/sajt finns (pub-id från ägaren) | HÖG vid ansökan | liten | samma deploy som ansökan |
| 8 | Privacy: nämn kontaktformulärets lagring; kontrollera Worker Pulse/shift poll-texten | LÅG-MEDEL | liten | kod |
| 9 | Stärk /today, /traffic, /corrections, /contact, /city-hall/projects (61-170 ord) med "vad betyder det / vad kan du göra" | MEDEL | medel | efter GSC-export |
| 10 | Besluta om /tonight och /this-weekend ska förbli indexerade när lokal data är tunn (alternativ: indexApproved av tills registret har fler poster) | MEDEL | liten | ägarens beslut |
| 11 | Lokal eventkälla (broomfield.org-kalender, inte biblioteket) | LÅG för AdSense, hög för användarvärde | stor | separat spec |

Deploys: EN deploy med #1, #3, #4, #5, #8 och kodgaten i #2 (allt kod/config; bygge x4, vitest, astro check). DB-skrivningarna (#2 avpublicering, #6) körs separat efter ägarens godkännande. ads.txt (#7) hör till ansökningsdagen. #9 väntar på GSC-exporten. Ansökan för Broomfield görs först när #1-#5 är live och verifierade, och utan att röra Moreno-omprövningen.

## Tillägg 2026-11-04: ägarens beslut och utredningar
- Beslut: de 34 AI-sidorna byggs inte längre för Broomfield (404; raderna ligger kvar i databasen, ingen DB-skrivning behövs eftersom bygget filtrerar), /contact/-påståendet om biblioteket borttaget, texten om AI-spåret borttagen på how-we-gather, advertising, editorial-policy, terms och llms.txt (för Broomfield), sourceBlurb rättad för Broomfield och Glasgow, ads.txt väntar tills ägaren ansöker. Allt detta ligger i en samlad lokal ändring (ej pushad). Brookings och Moreno har kvar texten och sina essäer; det är inte ändrat (ägaren har inte bett om det).
- Facility-sidor: ingen AI-utfyllnad, plan i .claude/specs/broomfield-facility-data-plan.md.
- Evenemangsutredning (stadskalendern broomfield.org), gjord 2026-11-04, ingen kod:
  - configs/broomfield_co.json har redan fyra iCal-feeds från stadens kalender: https://www.broomfield.org/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=65 (Out Loud), 66 (Out Loud Create), 73 (Holiday Cheer) och 77 (Waste & Recycling). De svarar tekniskt 200 med text/calendar.
  - MEN broomfield.org/robots.txt (`User-agent: *`) stänger nu `/common/modules/icalendar/`, `/RSS.aspx`, `/rss.aspx`, `/RSSFeed.aspx`, `/calendar.aspx` och `/CivicAlerts.aspx`; raden "added 2026-10-21 by Add-RobotsRules" kom dagen efter eventspecen. Crawl-delay 10. Filen har dessutom en lång lista AI-/SEO-botar med samma spärrar. Alltså: varken iCal, RSS eller kalendersidan är tillåtna enligt robots. Inget API hittades.
  - Slutsats: ingen av stadens egna kalenderkällor kan användas utan att bryta projektets robots-regel. Enda vägen är ett skriftligt tillstånd eller ett avsett flöde från staden (kommunikationsavdelningen), på samma sätt som biblioteket. Inget byggs. compass.broomfield.org rörs inte.
  - Min egen avvikelse: jag hämtade EN gång en av de spärrade iCal-URL:erna (kategori 65) för att se statuskod och innehållstyp, trots att robots.txt (som jag nyss läst) redan stängde sökvägen. Svaret kasserades och hämtningen upprepas inte; fler hämtningar mot de sökvägarna görs inte. Jag borde ha stannat vid robots-läsningen.
