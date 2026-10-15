# QA-genomgång, alla tre städer — 2026-10-15

Läsning endast. Inga fixar, inga DB-skrivningar, inga pushar utfördes under denna
genomgång. Alla tre städer byggdes lokalt (separata `site/dist-<town>/`), och
sitemap + intern länkcrawl + stickprov kördes mot de LIVE sajterna
(brookingsview.com, morenovalleyview.com, broomfieldview.com).

**Metod:** En Brookings-fokuserad subagent hann slutföra en djup A/B/D-granskning
(datum, dubbletter, faktakontroll mot Legistar/officiella källor) innan Claude-
sessionens rate limit stoppade de två andra (Moreno Valley, Broomfield)
subagenterna mitt i arbetet. Jag (huvudsessionen) tog över och verifierade
samma klasser av fel direkt mot DB + externa källor för de två städerna, samt
körde en egen mekanisk crawler (teknik/SEO, skräpsträngar, cross-town-läckor,
dubbletter i `<title>`) mot alla tre livesajter. Mobilkontroll (H, 390px) kunde
**inte** genomföras — Playwright-nedladdningen av en headless-browser timade ut
(ingen nätverksåtkomst till cdn.playwright.dev från den här miljön). Statisk
CSS-granskning av startsida/eventsida/mötessida gav inga uppenbara overflow-
risker, men detta är INTE samma som en riktig renderingskontroll — flaggas
explicit som ej testat, inte som godkänt.

---

## Översikt, grupperat efter grundorsak

| # | Grundorsak | Allvar | Städer |
|---|---|---|---|
| 1 | Inget efterarbete efter möten — beslut/utfall uppdateras aldrig | **Kritisk** | Alla 3 |
| 2 | `occurs_at IS NULL` kringgår färskhetsfiltret i "Worth knowing" | Hög | Brookings |
| 3 | Dubblettbevakning saknas vid story-generering från events | Hög | Brookings, Moreno Valley |
| 4 | ClusterNav länkar fortfarande till nedlagda innehållstyper | Medel–Hög | Alla 3 |
| 5 | Identiska `<title>`-taggar på återkommande/flerinstans-sidor | Medel–Hög | Alla 3 (störst på Moreno Valley) |
| 6 | `Astro.redirect()` i statiskt byggda sidor ger HTTP 200 istället för 301/302 | Medel | Alla 3 |
| 7 | Fakta-fel i facility-timmar (Brookings) | Hög | Brookings |
| 8 | Samma story dubbelrenderas på startsidan | Medel | Brookings |
| 9 | Celebration Park (Moreno Valley) har ej verifierbara öppettider | Låg/info | Moreno Valley |

Cross-town-läckor (sektion C): **inga hittade.** Allt min crawler initialt
flaggade (andra städers domännamn/stadsnamn) visade sig vara det avsiktliga
sammanlänkade syskonsajt-nätverket (footer-länkar + `sameAs` i JSON-LD) —
verifierat genom källkodsläsning, inte en läcka.

Teknisk hälsa (sitemap-URL:er → 200, redirect-loopar, robots.txt, RSS, JSON-LD-
syntax): **ren** på alla tre sajter, bortsett från punkt 6 ovan.

---

## 1. KRITISK — Möten/beslut uppdateras aldrig efter att mötet ägt rum

**Städer:** Brookings, Broomfield, Moreno Valley (bekräftat separat på alla tre;
tre olika källsystem — Legistar, AgendaLink, eSCRIBE).

**Bevis:**
- Brookings: `https://brookingsview.com/s/meeting-2026-10-13-14140/` (City
  Council, 2026-10-13). Legistars egen post
  (`webapi.legistar.com/v1/cityofbrookings/events/3543/eventitems`) visar att
  alla 17 ärenden redan är klara ("Approved/Pass" för bl.a. Resolution 26-064,
  26-065, Ordinance 26-024). Vår sida visar fortfarande alla 17 som `pending`
  och texten står i framtid ("will consider"). `dateModified` fryst på
  2026-10-08 (före mötet).
- Broomfield: `https://broomfieldview.com/s/meeting-2026-09-23-11341/` (möte
  för tre veckor sedan) — sidan säger fortfarande "The council **will
  consider**…" och "pending" x2. `datePublished`/`dateModified` låsta på
  2026-08-28, aldrig rört sedan.
- Moreno Valley: `https://morenovalleyview.com/s/meeting-2026-09-01-13781/`
  (möte för sex veckor sedan, publicerad en månad EFTER mötet redan ägt rum)
  — "The City Council **will hold**…", "The City Attorney **will report**…".

**Trolig grundorsak:** Pipelinen genererar/publicerar mötesartiklar från
förhandsagendan (bra), men det finns ingen senare jobb som hämtar de verkliga
utfallen efter mötesdatumet och patchar `meeting_decisions.outcome` /
regenererar artikeltexten. Detta är inte en källspecifik bugg (samma mönster
oavsett om källan är Legistar, AgendaLink eller eSCRIBE) — det är en saknad
pipeline-fas, gemensam för alla städer.

**Föreslagen fix:** Lägg till ett efterarbetesjobb som körs N timmar efter
`meeting_date`, hämtar om de verkliga utfallen (EventItems/motsvarande) per
källtyp, uppdaterar `meeting_decisions` och regenererar/patchar artikeln
(byt framtidsformuleringar till dåtid + lista faktiska utfall). Detta är
sannolikt den mest läsarkritiska bristen i hela genomgången — en civic-
nyhetssajt som aldrig berättar hur omröstningen gick.

---

## 2. HÖG — `occurs_at IS NULL` gör gamla möten odödliga i "Worth knowing" (Brookings)

**Stad:** brookings_sd. **URL:** `https://brookingsview.com/` ("Worth knowing").

**Bevis:** Startsidan visar (2026-10-15) bl.a. "Brookings County 765kV
Transmission Line Advisory Committee" (möte 2026-07-09, **3+ månader gammalt**)
med kroppstext i presens/futurum ("meets July 9") och "Brookings Health System
Board of Trustees" (möte 2026-06-29, 3,5 månader gammalt, "will meet Monday,
June 29"). DB bekräftar exakt 5 drabbade rader, alla publicerade 2026-07-18,
alla med `occurs_at IS NULL` trots att `meetings.meeting_date` har ett riktigt
(nu passerat) datum: `meeting-212`, `meeting-38`, `meeting-37`, `meeting-221`,
`meeting-226`.

**Grundorsak (bekräftad i källkod):** `site/src/lib/db.ts`,
`getWorthKnowingCandidates()`: `AND (featured = true OR occurs_at IS NULL OR
occurs_at >= now() - interval '24 hours')`. En rad med `occurs_at IS NULL`
kringgår färskhetsgränsen helt och är evigt valbar, sorterad
`occurs_at ASC NULLS LAST`.

**Fix:** Backfilla `occurs_at` från `meetings.meeting_date` för dessa 5 rader
(och framtida NULL-rader), och ändra SQL-villkoret så en NULL-datumrad åldras
ut via `published_at` istället för att vara evigt valbar.

---

## 3. HÖG — Dubblettbevakning saknas vid story-generering från events

**Städer:** Brookings (bekräftat live-dubblett), Moreno Valley (bekräftat i DB,
3–4x per händelse).

**Bevis, Brookings:** För lördag 17 okt 10:00 (SD Art Museum) visas SAMMA
fysiska event som **tre separata kort**: `/s/event-305361/` ("Community Art
Day", källa: visitbrookingssd.com), `/s/event-282136/` (samma titel, källa:
chamber_business/GrowthZone), `/s/event-282137/` ("Free Community Art Day",
samma hubb). En DB-sökning hittade **45 exakta dubblettgrupper**
(titel+starttid+plats) bland 125 kommande Brookings-events.

**Bevis, Moreno Valley:** DB-sökning (samma metod) hittar **10 dubblettgrupper**
bland kommande events, de flesta med 3–4 identiska rader per tillfälle, t.ex.
"MV MALL: Basic Computer Skills Class" (4 rader, samma tid/plats) och "MAIN
LIBRARY: Family Fun" (3 rader × flera datum). I det granskade stickprovet fick
bara en rad per grupp en egen story-sida (ingen bekräftad trippel-rendering
live som i Brookings-fallet ovan, men samma underliggande dubblett-DB-rader).

**Grundorsak:** Ingen cross-source-/närdubblettkontroll körs innan en
`stories`-rad genereras per `events`-rad. Samma kalenderkälla speglas via två
scraper-vägar (t.ex. stadens egen sida + dess GrowthZone/bibliotekskalender-
spegling), och varje spegling landar som en egen `events`-rad.

**Fix:** Deduplicera `events`-rader på normaliserad titel + samma kalenderdag
+ plats (eller titel+dag om plats saknas) innan story-generering, med
preferens för den rikaste källan (den med upplöst venue/adress).

**Notis om SEO-allvar:** Alla dubblett-story-sidor är `noindex,follow` — detta
är alltså INTE ett indexerings-/duplicate-content-problem för Google, bara ett
läsarupplevelseproblem (tre kort för samma sak).

---

## 4. MEDEL–HÖG — ClusterNav länkar fortfarande till nedlagda innehållsspår

**Städer:** Alla tre (bekräftat identiskt mönster).

**Bevis:** `ClusterNav`-komponenten ("More on …") renderas på många
innehållssidor (t.ex. `/jackrabbits/`, `/sports/`, `/vail-resorts/`, och på
recept-/recensions-/kolumnsidorna själva) och länkar ALLTID till `/recipes/`,
`/editorials/`, `/columns/` (och `/reviews/` förutom för Moreno Valley, som har
en egen 301 dit). Senaste innehållet där är nu **1–2+ veckor gammalt**
(`recipe-2026-10-01` är den senaste på alla tre, dvs 2 veckor gammal per
2026-10-15) — det generiska AI-innehållsspåret stängdes av 2026-10-07 enligt
`AdSense-saneringsprojektet` (Fas 0), och skulle enligt tidigare kommentarer
"inte längre länkas från startsidan". Hittade på Brookings (65 instanser),
Moreno Valley (minst 3 instanser i det granskade stickprovet) och Broomfield
(34 instanser).

**Grundorsak (bekräftad i källkod):** `site/src/config/clusters.ts`,
`ROUTE_AVAILABILITY`: `recipes: () => true`, `editorials: () => true`,
`columns: () => true` (aldrig villkorade på om spåret fortfarande genererar
nytt innehåll) — till skillnad från t.ex. `sports`/`jackrabbits`/`vail-resorts`
som korrekt är hård-gated per stad. Både index-sidorna (`/recipes/` etc, redan
`noindex,follow`) och de enskilda story-sidorna (också `noindex`) är alltså
inte ett indexeringsproblem, men de är fortfarande en aktiv, besökt länkväg
för riktiga läsare in i ett fruset innehållsspår.

**Fix:** Lägg till ett verkligt villkor i `ROUTE_AVAILABILITY` för dessa fyra
nycklar (t.ex. "har detta spår publicerat något de senaste N dagarna") istället
för `() => true`, så ClusterNav slutar visa dem när spåret är dött.

---

## 5. MEDEL–HÖG — Identiska `<title>`-taggar på återkommande/flerinstans-sidor

**Städer:** Alla tre. Störst omfattning på Moreno Valley (60+ träffar i ett
2000-sidors stickprov, flera Ticketmaster-shower med **5–16 separata
URL:er som delar exakt samma `<title>`**, t.ex. "MAIN LIBRARY: Lunch at the
Library" på 16 sidor). Brookings: ~34 träffar (t.ex. "Oregon Trail Game - Slot
1–4", veckovisa "Notice: possible quorum" på 5 olika mötesdatum, 6
Ticketmaster-föreställningar av "Disney On Ice"). Broomfield: mindre omfattning
men samma mönster.

**Bevis:** T.ex. `/s/event-304484/` och `/s/event-305363/` ("Silent Film with
Pipe Organ…") har IDENTISK `<title>` men olika verkliga datum (16 resp. 17
okt — kontrollerat via `startDate` i sidans JSON-LD, så det är INTE en
datadublett, bara en titel-tagg utan datum/instans-särskiljare).

**Grundorsak:** `<title>` för återkommande eventserier och
flerföreställnings-Ticketmaster-poster byggs utan datum/tillfälle i strängen,
så varje instans av samma serie/show delar exakt titel.

**Fix:** Inkludera datum (eller showtime) i `<title>` för dessa sidtyper.
Lågrisk, välavgränsad fix; påverkar SEO/användarupplevelse (bokmärken,
webbläsarflikar, sökresultat kan inte skilja instanserna åt) men är inte en
sakfelsrisk.

---

## 6. MEDEL — `Astro.redirect()` på statiskt byggda sidor ger HTTP 200, inte 301/302

**Städer:** Alla tre (samma kodmönster, ~19 routes berörda:
`sports`/`jackrabbits`/`vail-resorts`/`university`/`play`/`farm-report`/
`burro-bonanza`/`home-sales`/`workplace-watch`/`whats-on`/`new-in-town`/
`this-week/index`/`month/index`/`closures` m.fl.).

**Bevis:** `curl -D- https://broomfieldview.com/sports/` → **`HTTP/1.1 200 OK`**,
inget `Location`-huvud, body är en klientsidig
`<meta http-equiv="refresh" content="2;url=/">`-shell utan riktigt innehåll
(och noll `<h1>`, vilket är så min crawler hittade det). Samma bekräftat för
`brookingsview.com/sports/`, `broomfieldview.com/jackrabbits/`,
`brookingsview.com/home-sales/`, `morenovalleyview.com/jackrabbits/` — alla
200, inte 301/302. En verkligt obefintlig URL (`/this-finns-inte-xyz/`) ger
dock korrekt 404 på alla tre, så det är specifikt sidor som FINNS som en
statisk fil men bara innehåller ett `Astro.redirect(...)`-anrop som drabbas.

**Grundorsak:** `return Astro.redirect('/', 302)` inuti en Astro-sida utan
dynamiska parametrar bakas, under statiskt bygge (`astro build`, ingen SSR),
till en HTML-shell med klientsidig meta-refresh och statuskod 200 — Cloudflare
Workers Static Assets har ingen `_redirects`-mekanism kopplad här som skulle
ge en riktig 3xx för dessa förbyggda filer.

**Fix:** Antingen (a) konfigurera `_redirects`/`wrangler.jsonc`-regler för
dessa kända routes så Cloudflare själv svarar 301/302, eller (b) hoppa över att
bygga dessa filer alls för de städer där de inte gäller (låt dem 404:a äkta,
precis som en verkligt obefintlig URL redan gör). Låg praktisk påverkan på
läsare (snabb klient-redirect till startsidan), men fel HTTP-semantik för
botar/crawlers som inte kör JS.

---

## 7. HÖG — Fakta-fel i facility-öppettider (Brookings)

**Stad:** brookings_sd.

- **`https://brookingsview.com/facilities/public-library/`** — sidan säger
  mån–tors **9:30–21:00**. Bibliotekets egen sida
  (brookingslibrary.org) säger mån–tors **9:30–20:00**. En timme fel
  stängningstid. (Fre–lör och sön stämmer.)
- **`https://brookingsview.com/facilities/city-hall/`** — sidan säger mån–tors
  **07:00**–17:00. Officiell källa
  (cityofbrookings-sd.gov/facilities/facility/details/City-and-County-
  Government-Center-16) säger mån–tors **08:00**–17:00. En timme fel
  öppningstid.
- **`https://brookingsview.com/facilities/mccrory-gardens/`** — telefon och
  öppettider saknas helt (`NULL`) trots att båda finns lätt tillgängliga på
  den redan citerade källan (sdstate.edu/mccrory-gardens/plan-your-visit-
  mccrory): tel. 605-688-6707, säsongsöppettider.

**Fix:** Korrigera `hours_text` för `public-library` och `city-hall`;
backfilla `phone`/`hours_text` för `mccrory-gardens` från redan citerad källa.
(6 andra Brookings-facilities stickprovskontrollerades och matchade exakt —
detta verkar vara isolerade fel, inte ett systemfel i ingestionen.)

**Övriga städer:** Moreno Valley (City Hall, Huvudbiblioteket) och Broomfield
(Community Center, Paul Derda Recreation Center) stickprovskontrollerades mot
officiella källor och **matchade exakt** — inget liknande fel hittat där i det
granskade urvalet.

---

## 8. MEDEL — Samma story dubbelrenderas på startsidan (Brookings)

**Stad:** brookings_sd. **URL:** `https://brookingsview.com/`.

**Bevis:** "Notice: possible quorum — Hobo Day Parade"
(`/s/meeting-2026-10-24-14067/`) visas **två gånger på samma sidladdning** —
en gång i "Worth knowing"-floden och en gång som första posten i "Coming
up"-floden direkt under.

**Grundorsak:** `homepage-curation.ts` har redan logik (`usedSlugs`) som
förhindrar att Worth Knowing upprepar hero/secondary-urvalet, men "Coming up"
är en tredje, separat flod i `index.astro` som inte stäms av mot Worth
Knowings urval.

**Fix:** Utöka `usedSlugs`-uteslutningen till att även täcka vad som fyller
"Coming up"-floden.

---

## 9. LÅG / INFO — Celebration Park (Moreno Valley): öppettider kunde inte verifieras

**Stad:** moreno_valley_ca. **URL:**
`https://morenovalleyview.com/facilities/celebration-park/`.

**Bevis:** Sidan anger "Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward" — en
ovanlig öppettidsstruktur för en kommunal park (vanligtvis "gryning till
skymning" utan fasta klockslag, och "Sun 10am onward" utan sluttid är en
ovanlig formulering). Sökning efter officiell bekräftelse gav ingen träff
inom tidsramen för denna genomgång.

**Rekommendation:** Inte en bekräftad felaktighet — flaggas för ägarens egen
uppföljning mot `moval.org`, inte en verifierad bugg.

---

## Vad som INTE hanns med / kända begränsningar

- **H (mobil, 390px):** Ej testat med riktig rendering — Playwright kunde inte
  ladda ner en headless Chromium i den här miljön (nätverkstimeout mot
  cdn.playwright.dev). Ingen uppenbar overflow-risk i statisk CSS-granskning
  av startsida/eventsida/mötessida/projektsida, men detta ersätter inte en
  riktig viewport-test.
- **Månadssidor:** Endast Moreno Valley har `/month/[slug]/` (gated på
  `townId === 'moreno_valley_ca'` i `ROUTE_AVAILABILITY`) — Brookings och
  Broomfield har ingen sådan sida alls, så "räkna om månadssidans siffror" var
  inte applicerbart där. Moreno Valleys septembersida lästes och siffrorna
  (2 projekt, 5 events, 24 trafikincidenter, 469 jobb) såg rimliga ut vid
  genomläsning, men hanns inte räknas om oberoende mot DB inom tidsramen —
  flaggas som ej oberoende verifierat, inte som godkänt.
- **20 events per stad mot källan:** Genomfört fullt för Brookings (via
  subagent, inkl. .ics-kontroll och Legistar-avstämning). För Moreno Valley
  och Broomfield gjordes ett mindre, riktat urval (möteskontroller + DB-
  dublettsökning) snarare än 20 fullständiga käll-för-käll-kontroller per
  stad, eftersom de dedikerade subagenterna för dessa städer avbröts av en
  rate limit innan de hann slutföra. Inget tecken på systematiska datum-/
  tidszonfel hittades i det som faktiskt kontrollerades.
- **Beslut vs. Legistar/AgendaLink, 10 st per stad:** Brookings: fullt
  genomfört. Broomfield: stickprov (25 beslut, senaste ~5 veckor) — alla
  "Pass", men **inga beslut alls finns för de tre senaste faktiska mötena**
  (23 sep, 30 sep, 14 okt) — se fynd #1, samma rotorsak. Moreno Valley: `
  meeting_decisions` har **noll rader** för staden (källan är eSCRIBE/
  RivCo-Legistar för county-möten, ingen beslutsspårning verkar vara kopplad
  för de egna stadsmötena) — detta är egentligen samma rotorsak-familj som
  fynd #1, bara i sin mest extrema form (ingen beslutsdata alls, inte bara
  gammal).
