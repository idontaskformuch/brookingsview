# Glasgow-universiteten: utredning 2026-10-28 (bara rapport, ingen kod)

Metod: robots.txt hämtad med vår egen bot-UA (ViewMediaBot), sidor och feeds provade med curl, innehåll läst med WebFetch/WebSearch. Inga omvägar runt bot-skydd. Inga villkor (terms of use) har lästs juridiskt; det är kvar per källa innan något byggs.

## Sammanfattning per institution

| Institution | Eventkalender | iCal / RSS / JSON-LD | Robots | Kan vi hämta automatiskt? |
|---|---|---|---|---|
| University of Glasgow | Ja: https://www.gla.ac.uk/events/listings/ (79 event nu), serverrenderad HTML. Kategorier: Public lectures, Exhibitions, Hunterian, Concerts and music, Social/Community/Academic/Alumni events, Courses. Fält: titel, datum, tid, plats, kategori, beskrivning, länk till /event/<id> | Nej (0 träffar på ics, rss, ld+json, schema.org/Event) | Ingen spärr för /events/ (bara /services/library/Events/); inga AI-bot-regler | Ja, som HTML-skrapning, samma metod som Glasgow Life |
| Hunterian (UoG) | https://www.gla.ac.uk/hunterian/visit/whats-on/ (samma T4-system, 48 poster) | Nej | Som ovan | Ja, HTML |
| Music in the University (UoG) | https://www.gla.ac.uk/events/musicintheuniversity/events/: lunchkonserter torsdagar 13.15 i University Concert Hall, biljett via Eventbrite ("Register") | Nej | Som ovan | Ja, HTML; pris/gratis står inte |
| University of Strathclyde | Ingen samlad publik kalender hittad (/events/ och /whatson/ ger 404). Splittrat: bibliotekets kalender, Strath Union, Careers, conferences (onlineshop.strath.ac.uk), David Elder-föreläsningar (Glasgow Science Centre) | Nej | Bara en Funnelback-regel (Allow: /), annars ingen spärr | Inget bra mål; bibliotekets lista (strath.ac.uk/professionalservices/library/getstarted/libraryevents/) och Visit-dagar är möjliga men små |
| Glasgow Caledonian University | Öppen-dag/rekryteringsevent (gcu.ac.uk/study/opendays); ingen publik föreläsningskalender hittad | Ej kontrollerbart | **Cloudflare managed challenge: 403 på robots.txt och alla sidor för oss** | NEJ. Hämta inte; bara länkar, eller fråga GCU om en feed |
| Glasgow School of Art | https://gsaexhibitions.co.uk/ (Reid Gallery, utställningar och talks; "free but ticketed" via Eventbrite); öppna dagar/Open House 30-31 okt; gsa.ac.uk har ingen egen events-URL som svarar för oss (404/301) | Nej | gsa.ac.uk robots.txt tom (inga regler) | Möjligt men skört: gsaexhibitions.co.uk är en WordPress-sajt med kategorier (upcoming-events, talk-event, reid-gallery); Eventbrite-sidor ska inte skrapas (villkor) |
| Royal Conservatoire of Scotland | https://www.rcs.ac.uk/whats-on/ och /whats-on-search/ (konserter, drama, musikal; biljett via Box Office, 0141 332 5057) | Nej | `Disallow: /admin/*` bara | Ja, HTML; plats saknas i listan (finns på eventsidan), pris/gratis ej angivet, "Sold out" markeras |

Slutsats om format: **ingen av fem har iCal, RSS eller schema.org Event**. Allt är HTML-skrapning (UoG och RCS rimligt, GSA via exhibitions-sajten, Strathclyde marginellt, GCU spärrat).

## Vad är öppet för allmänheten och var står det

- **University of Glasgow**: Public lectures (t.ex. Geological Society of Glasgow, gratis, 2:a torsdagen varje månad kl 19, Kelvin Hall, t.o.m. 8 apr 2027), utställningar (Library level 2 "Glasgow Makes People"), Memorial Chapel-orgelkonserter (lunchtid), Music in the University, Hunterian-talks (James McCune Smith Lecture 12 nov, kräver registrering). Källa: gla.ac.uk/events/listings/ + kategori.
- **Hunterian**: Hunterian Art Gallery (Autumn Rotation till 17 jan 2027; Duncan Shanks 30 okt-2 maj 2027), Mackintosh House (guidade turer, bokning), Kelvin Hall (Twilight Tours 9 dec, filmvisning 13 nov), Look Club / Little Look Club (gratis familj 19 dec). Öppettider och inträde står INTE på whats-on-sidan: de finns på /hunterian/visit/our-venues/ (ej läst) och notices-sidan för stängningar. Verifiera innan en guide skrivs.
- **Strathclyde**: Visit Strathclyde (14 okt, 18 nov), bibliotekets evenemang (Black History Month, Book Week Scotland 16-22 nov), Town & Gown- och David Elder-föreläsningar (via Glasgow Science Centre). Mest studentriktat.
- **GCU**: främst rekrytering (Postgraduate Open Evening 5 nov 16.30). Offentliga föreläsningar ej funna (SPIRU "pledginars" äldre).
- **GSA**: Reid Gallery-utställningar (Married Life of Atoms till 31 okt; Sharon Kivland 5 okt-11 dec; Jill Posener 14 nov-9 jan), talks (Maud Sulter Annual Lecture 22 okt, Reid Lecture Theatre, gratis med biljett), campusturer via Eventbrite. **Mackintosh Building är inte öppen** (återuppbyggnad pågår, inga turer/datum).
- **RCS**: offentliga konserter och föreställningar i Alexander Gibson Opera School, Stevenson Hall m.fl. (RCS Chamber Orchestra 11 nov, Machinal 28-30 okt, Jazz Orchestra 18 nov, RCS Choir 26 nov, 9 to 5 1-4 dec: slutsåld), "Fridays at One"-serien. Alla med biljett via Box Office; vissa gratis (ej angivet i listan).

## Terminsdatum, freshers, examen: officiella källor 2026-27

- **UoG**, https://www.gla.ac.uk/myglasgow/policy/sessiondates/session2026-27/ (läst): Welcome Week mån 14 sep 2026; sem 1 undervisning 21 sep-4 dec; graduation 30 nov-11 dec; tentor 7-18 dec; sem 1 slut 18 dec; vinteruppehåll 21 dec-8 jan; January Welcome Week 6-8 jan; sem 2 11 jan-26 mar (undervisning); påskuppehåll 29 mar-16 apr; tentor 26 apr-21 maj; sem 2 slut 28 maj; graduation 23 jun-7 jul; omtentor 26 jul-13 aug.
- **Strathclyde**, https://www.strath.ac.uk/keydates/2026-27/ (läst): Welcome week 14-20 sep; teaching block 1 21 sep-6 dec; tentor 7-18 dec; juluppehåll 19 dec-10 jan; block 2 18 jan-4 apr; påsk 5-18 apr; tentor 19 apr-21 maj; sommaruppehåll 22 maj-12 sep; graduations "to come". Notera: flera helgdagar listade.
- **GCU**, https://www.gcu.ac.uk/currentstudents/essentials/timetable/calendar/academic-calendar-20262027 (sidan blockerar oss; uppgifterna är ur söksnippet, ej verifierade): Trimester A induktion 7-11 sep, undervisning 14 sep-27 nov, tentor 7-18 dec; B 25 jan-9 apr, tentor 19 apr-7 maj; C 10 maj-16 jul; graduation 24-25 nov 2026 och 29 jun-1 jul 2027.
- **RCS**, https://www.rcs.ac.uk/term-dates/ (söksnippet, ej fullständigt läst): Term 1 21 sep-11 dec; Term 2 5 jan-26 mar 2027; Term 3 (MA m.fl.) 12 apr-18 jun.
- **GSA**: ingen officiell termin-/kalendersida hittad. Tredjepart (studieresebyrå) anger höst 21 sep-12 dec, otillräckligt. Kontakta registry eller leta på gsadocuments.net. Degree Show brukar vara slutet maj-början juni.

Sammanfallande mönster: Welcome Week mån 14 sep, undervisning 21 sep, tentor 7-18 dec, uppehåll över jul, påsk 29 mar-16 apr, tentor apr-maj. Stadens "studentår" kan alltså byggas ur två verifierade officiella källor (UoG, Strathclyde) plus GCU/RCS när de kontrollerats.

## Förslag (inget byggt, väntar på godkännande)

**(1) Källor in i /events och kvällslagret** (konkret fråga från en invånare: "Vad kan jag gå på gratis eller billigt i kväll/den här veckan?")
- Fas A: UoG events/listings + Hunterian + Music in the University, ett skrapflöde (samma T4-HTML), filtrerat till det som uttryckligen är öppet för allmänheten: kategorierna Public lectures, Exhibitions, Hunterian, Concerts and music. Uteslut Courses, Alumni, Academic events, Social events (internt). Källhänvisning och länk tillbaka som för Glasgow Life; kategori/tagg via de nya reglerna (plats Museums & exhibitions / Music, "Public lectures" som egen kategori "Talks & workshops").
- Fas B: RCS what's-on (konserter/föreställningar; plats hämtas från eventsidan, pris ej känt så ingen "free"-märkning).
- Fas C: GSA via gsaexhibitions.co.uk (bara upcoming-events/talk-event/reid-gallery), om villkoren tillåter.
- Strathclyde: bara manuellt kurerade punkter (Visit Strathclyde, Book Week Scotland) eller hoppa över. GCU: inte alls utan avtal.
- Kvällslagret: konserter/föreläsningar efter 17.00 (UoG chapel, RCS, Maud Sulter-typen) ger riktiga "tonight"-poster, som /today saknar nu.
- Risker: AI-sammanfattning av skolinternt innehåll (kräver strikt kategorifilter), tunt innehåll (spec .claude/specs/weekend-layer.md low-value-skydd gäller), ingen feed = skör HTML, villkor ej lästa.

**(2) Guide "Glasgow's universities open to the public"**: en indexerbar kurerad sida, handskriven kort text per institution: vad som är öppet (Hunterian, Reid Gallery, RCS-konserter, Memorial Chapel, public lectures), hur man bokar (Eventbrite/Box Office), hur man tar sig dit, vad som INTE är öppet (Mackintosh Building, GCU-föreläsningar saknas). Datakälla: sidor ovan + öppettider ur Hunterians our-venues (inte läst än, måste verifieras). Besvarar: "Vad kan jag som icke-student besöka på universiteten?" Kräver verifierade öppettider/inträde innan publicering; ingen AI-text utan källa.

**(3) Universitetsåret för staden**: en sida/ruta "Student year" med Welcome Week, terminsstart, tentor, graduation, uppehåll för UoG + Strathclyde (+GCU/RCS efter verifiering), och vad det betyder för invånare (trängsel i West End/Merchant City, hyror/flyttdagar, bussar, parkering vid graduation, kvällsliv). Besvarar: "Varför är Byres Road/Subway fullt just nu?" Datakälla: officiella sessiondates-sidor, uppdateras årligen (lägg i .claude/annual.md, augusti). Kan enkelt bli en tidslinje och en rad på /today under Welcome Week och tentavecka.

## Öppna frågor till ägaren

1. Godkänner du Fas A (UoG-flödet) som första byggsteg? Det är enda källan med riktig struktur och stor volym.
2. GCU: vill du att jag mejlar GCU och ber om en feed/tillstånd, eller släpper vi dem?
3. Ska terms of use läsas per källa innan något byggs (rekommenderas, görs som första steg i Fas A)?
4. GSA:s terminsdatum: ska jag försöka via registry-mejl eller utelämna GSA ur "universitetsåret"?
