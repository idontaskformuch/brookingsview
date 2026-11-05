# Fas 3 (möten): förslag till ägaren, 2026-11-05. Inget byggt. Väntar på ja.

Fråga från en invånare som sidan besvarar: "Vad beslutas i min stad snart, av vem, när och var, och hur når jag handlingarna?"
Datakällor lästa read-only mot live-databasen. Ingen skrivning, inget push.

## 1. Moreno: scrapern är inte trasig, källan är tom
- Scrapern (escribe_v1) körs dagligen, status ok, http 200, 14 poster per körning, senast 2026-11-04 23:01 UTC.
- Ett läsande anrop mot samma endpoint (GetCalendarMeetings, ärlig UA, ingen skrivning) med fönstret idag-7 d till idag+150 d returnerade bara 2026-11-03 (Council Regular + Closed Session). Scraperns fönster är -60/+45 d, så fönstret är inte orsaken.
- eSCRIBE publicerar ett möte först 4-7 dagar innan (lead time ur vår egen data: Council 4-5 d, Planning Commission 6-7 d, enstaka 13 d). Rådet möts 1:a och 3:e tisdagen -> nästa regular är 2026-11-17 och bör dyka upp ca 11-13 nov.
- Slutsats: 0 kommande är normalt mellan möten. Sidan måste hantera tomt läge permanent, inte som undantag: "No upcoming meetings posted yet" + länk till eSCRIBE-portalen + senaste mötena.
- Två små fynd (ej fixade): (a) raw_data.Location innehåller U+FFFD ("City Hall Council Chamber � 14177 Frederick Street", en tankstreck tappat i teckenkodningen); (b) agenda_url är tom sträng på alla 36 Moreno-rader, länken måste byggas ur raw_data (ShareUrl/MeetingDocumentLink). Båda ska in i Moreno-bygget med QA-kontroll + fixtur (regel 12).

## 2. BODIES-förslag per stad
Principen från filens egen kommentar gäller: exakt match på källans egen sträng, okänt organ faller tillbaka på eget namn (syns, försvinner inte), olika organ slås aldrig ihop.
Ny regel: en QA-kontroll "okänt organ i databasen" (visar organ som saknas i BODIES) så att tabellen inte åldras tyst.

### Broomfield (först)
Källan (AgendaLink) ger mötestyp, inte organ: alla rader är City Council. Förslag: ETT organ + en typ-etikett.
| Källsträng (antal) | organ | typ | not |
|---|---|---|---|
| City Council Regular Meeting (14) | City Council | Regular | |
| City Council Study Session (9) | City Council | Study session | |
| City Council Special Meeting (6) | City Council | Special | |
| City Council Executive Session (5) | City Council | Executive session | stängd för allmänheten, ingen agenda, visas som "Closed session" utan kommentarsguide |
| City Council Transition Meeting␣ (1, avslutande mellanslag i källan) | City Council | Transition | 2026-12-02 UTC = 12-01 lokalt |
| City Council Workshop (1) | City Council | Workshop | |
- Tidszon America/Denver, hasTime true, ämnesetiketter PÅ (Brookings-reglerna), amerikansk stavning.
- Officiell agendasida: ÖPPEN FRÅGA. Enda publika vyn i config (public_viewer) är sandbox.agendalink.app, som sajten aldrig länkar (isSandboxUrl-spärren). Jag föreslår att länka stadens egen rådssida på broomfield.org (URL ej verifierad, inget hämtat; länkning hämtar inget). Agendalistan visas tills dess som verbatim-titlar utan länk. Säg vilken URL du vill använda.
- Sandbox-spärren ändras inte.

### Glasgow
Huvudnämnder synliga, Area Partnerships i en utfällbar grupp. Grupperas med regel, inte lista: organ som slutar på "Area Partnership" -> grupp "Area Partnerships". Idag 22 av 26 finns i data (4 inte schemalagda i fönstret); regeln fångar dem när de kommer.
Synliga huvudorgan (organ som finns i data nu): Glasgow City Council; City Administration Committee; Planning Applications Committee; Planning Local Review Committee; Licensing and Regulatory Committee; Licensing Board; Contracts and Property Committee; Finance and Audit Scrutiny Committee; Operational Performance and Delivery Scrutiny Committee; 5 City Policy Committees (Wellbeing/Equalities/Communities/Culture/Engagement; Economy/Housing/Transport/Regeneration; Net Zero and Climate Progress Monitoring; Environment and Liveable Neighbourhoods; Education/Skills/Early Years); Glasgow City Region Cabinet; Strathclyde Pension Fund Committee; Safe Glasgow Partnership; Glasgow City Integration Joint Board (+ IJB Finance Audit and Scrutiny, IJB Public Engagement).
Ej med: Local Negotiating Committee for Teaching Staff (personalförhandling) - förslag: dölj (som Personnel Appeals redan exkluderas), din bedömning.
- Chips per GRUPP, inte per organ (beslut: chips >=3 träffar, >=2 chips, inga siffror): Council and committees / Planning / Licensing / Health and care (IJB) / Area Partnerships. Max 6 kategorifärger per sidtyp; chips grupperar bara, ingen färg per organ.
- Ämnesetiketter AV (spec). Tidszon Europe/London, brittisk stavning (Licensing, Neighbourhoods ...), källa CoInS, länk till public_viewer.
- UK-grind: agendarubriker kan nämna enskilda; befintlig uk_guardrails gäller, verbatim titlar visas bara om grinden släpper dem (ska verifieras i bygget).

### Moreno
| Källsträng (antal) | organ | not |
|---|---|---|
| City Council Regular Meeting (11) | City Council | Regular |
| Closed Session City Council Meeting (8) | City Council | Closed session |
| Study Session City Council Meeting (5) | City Council | Study session |
| City Council Special Meeting (1) | City Council | Special |
| Planning Commission (11) | Planning Commission | |
- Samma modell som Broomfield: ett rådsorgan + typ. Tidszon America/Los_Angeles, hasTime true. Tomt läge enligt punkt 1. Länk: pub-morenovalley.escribemeetings.com.
- Dagsdatum måste beräknas lokalt (Council 18:00 PT är nästa dygn i UTC; samma klass av fel som tidsbuggen i Tonight, beslut 10).

### Brookings (finns, kompletteras)
BODIES-kommentaren säger "alla 134 rader kontrollerade" men 6 organ i databasen saknas i tabellen (faller idag tillbaka på eget namn, tone other):
Brookings County 765kV Transmission Line Advisory Committee (3), Brookings County Housing & Redevelopment Commission (2), Brookings County Outdoor Adventure Center Advisory Board (2), Weed & Pest Board (1), Extension Board (1), Local Emergency Planning Committee (1). Förslag: lägg till med tone other, och sätt kommentaren till datum. Ingen annan ändring.

## 3. Dedup-fall (datarader)
Regeln i buildMeetings: (1) Notice of Quorum är inte ett möte; (2) samma datum + samma normaliserade organ -> behåll Legistar-raden, fyll saknade fält från den andra; (3) olika organ slås aldrig ihop, utom stad+county "joint meeting".
| Stad | Fall | Rader | Utfall |
|---|---|---|---|
| Brookings | 134 rader totalt: 105 Legistar, 29 county; 31 är Notice of Quorum | - | 31 bort enligt regel 1. Efter det finns 0 grupper med samma datum + samma organ-sträng. |
| Brookings | 2026-11-04 Joint Board of Adjustment | 15099 (county: "Brookings County/City of Brookings Joint Board of Adjustment") + 15132 (Legistar: "Joint Board of Adjustment") | samma organnyckel -> slås ihop, Legistar behålls |
| Brookings | 2026-11-04 Planning Commission 15131 vs county Planning & Zoning Commission 15100 | olika organ | slås INTE ihop (avsiktligt) |
| Brookings | 2026-09-08 City Council 11874 (regular 18:00) + 11875 (Notice of Quorum 17:30) | | quorum bort, regular kvar |
| Brookings | 2026-10-10 Historic Preservation 13999 + 14000 | båda Notice of Quorum (11:00 resp. 13:30, olika lokaler) | båda bort |
| Broomfield | 2026-12-01 18:00: City Council Regular (11824, 16 punkter) + Transition Meeting (11825, 0 punkter) | olika källsträngar | slås INTE ihop. Båda visas; Transition märks. Din bedömning: behåll båda (förslag) eller dölj Transition utan agenda. |
| Moreno, Glasgow | 0 grupper med samma lokala datum + organ | | ingen dedup behövs idag |
Risk: regel 2 grupperar på datum+organ. Med Broomfields "ett organ + typ"-modell måste nyckeln bli datum + organ + typ, annars slås Regular och Study Session samma dag ihop. Ingen sådan dag finns i datan idag, men regeln ska ha ett test.

## 4. Tre exempelmöten per stad (rader ur databasen, lokal tid, verbatim)
### Broomfield (kommande)
1. City Council Regular Meeting | tis 2026-11-10 18:00 | Council Chambers | 19 agendapunkter (första: "Land Acknowledgement") | agendalänk: sandbox, visas ej
2. City Council Study Session | tis 2026-11-17 18:00 | Council Chambers | 4 punkter ("City and County of Broomfield Website Refresh Update", "Evacuation Mapping and Resources")
3. City Council Regular Meeting | tis 2026-12-01 18:00 | Council Chambers | 16 punkter (första: "Swearing In of Councilmember Peterson") + Transition Meeting samma tid, 0 punkter (dedupfallet ovan)
### Glasgow (kommande)
1. Licensing Board | fre 2026-11-06 10:00 | City Chambers, Glasgow | 4 punkter ("Approval of Minutes of Previous Meeting - 9th October 2026", "Licensing (Scotland) Act 2005 - Applications for Various Types ...")
2. Newlands/Auldburn Area Partnership | fre 2026-11-06 11:00 | Committee Room (Hybrid) City Chambers | 10 punkter (undergrupp Area Partnerships)
3. Planning Local Review Committee | tis 2026-11-10 11:30 | by video conference | 2 punkter (platsadresser, t.ex. "Site adjacent to 127 Causewayside Street (Ward 19) - 26/0004")
### Moreno (inga kommande, tre senaste)
1. City Council Regular Meeting | tis 2026-11-03 18:00 | City Hall Council Chamber, 14177 Frederick Street | agenda ej publicerad i källan (HasAgenda false), 0 punkter
2. Closed Session City Council Meeting | tis 2026-11-03 16:00 | samma | 0 punkter (stängd)
3. City Council Regular Meeting | tis 2026-10-20 18:00 | samma | 46 punkter (första "CALL TO ORDER")
### Brookings (kommande, efter filtrering av Notice of Quorum)
1. Utility Board | mån 2026-11-09 13:00 | Brookings Municipal Utilities Building | 0 punkter
2. Utility Board | mån 2026-11-23 (klockslag ej kontrollerat) | samma | 0 punkter
Bara 2 riktiga kommande möten finns i datan. Brookings City Council 2026-11-09 och 2026-12-02 är i dagsläget Notice of Quorum och visas inte; nästa riktiga rådsmöte saknas i datan (3:e exemplet = dedupfallet Joint Board of Adjustment 2026-11-04 ovan, redan förbi).

## 5. Notiser: "få notis när något nytt publiceras"
Gemensamt: sajten är statisk och byggs om vid varje push och var 6:e timme (scrape-cron), så allt som genereras vid bygget är som mest 6 h gammalt. Inget av A/B sparar personuppgifter.
Vad "nytt" betyder, ur data: nytt möte schemalagt; agenda publicerad (Glasgow agenda_published, Legistar EventAgendaLastPublishedUTC; för Broomfield/Moreno bara "första gången vi såg den"); protokoll publicerat.

| | A. RSS per organ + hela staden | B. .ics-prenumeration (webcal) | C. E-post |
|---|---|---|---|
| Vad läsaren får | Post per nytt möte / ny agenda / nya protokoll: titel, datum, länk. Ingen prosa. | Kommande möten i den egna kalendern; nya möten dyker upp av sig själva. Ger inte "agenda publicerad". | Mejl per valt organ när något nytt publicerats. |
| Bygge | Statiska filer /city-hall/rss.xml och /city-hall/<organ>/rss.xml via befintliga @astrojs/rss; `<link rel=alternate>` på mötessidorna. Behöver "första-sett"-tidsstämpel per rad (finns created_at). | Statisk /city-hall/calendar.ics (+ per organ); ics-byggaren finns redan (buildMeetingIcs, per-möte .ics finns). | Formulär -> Worker + tabell (subscribers) + dubbel opt-in + avprenumeration + Cloudflare Email Service (skill finns) + Turnstile mot missbruk + cron som upptäcker nya rader. Integritetstext/samtycke (UK PECR/GDPR för Glasgow). |
| Kostnad | 0 kr drift | 0 kr drift | Utskick: beror på Cloudflare Email Service-prissättning (ej verifierad här, kontrollera innan beslut) + databaslagring; mest tid, inte pengar. |
| Komplexitet | Låg | Låg | Hög (störst av de tre; egen fas) |
| Aktualitet | upp till 6 h | kalenderklienter hämtar var 12-24 h (Google är långsammast) | minuter (Workern körs */15) |
| Räckvidd | låg (få invånare använder RSS) | medel (kalender används) | hög |
| Risk | ingen | ingen; dubbletter om samma möte finns i två feeds | missbruk, studsar, juridik, support |
Web push (service worker finns redan) nämns men rekommenderas inte nu: kräver samma prenumerationslager som e-post, iOS kräver installerad PWA, svagare leverans.
Rekommendation: A + B ingår i Fas 3 (billiga, ingen persondata, återanvänder befintlig kod). C som separat beslut senare, när A/B visat att någon bryr sig (mät träffar på feed-URL:erna i Cloudflare-loggar). Allt tre svarar på samma invånarfråga: "Hur får jag veta att det finns en ny agenda utan att komma ihåg att titta?"
