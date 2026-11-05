# Fas 4: granskningslista (2026-11-05, lokalt, ej pushat)

Skärmdumpar 390 px, ljust och mörkt, alla fyra: `<stad>-before-…` / `<stad>-after-…` (/events/) och `<stad>-home-before-…` / `<stad>-home-after-…` (startsidan). Inventeringen med bilder: `../gaps/INVENTORY.md`.

Batteri: vitest 2264, pytest 1239 (11 skipped), astro check 0 fel, build ×4 exit 0, disjoint OK 39/88/116/25. Alla bilder 390 px breda (ingen horisontell scroll).

## Vad som byggdes (svarar på: "Vad händer idag och i veckan här?")
1. **/events/ och startsidan delar en pipeline** (`lib/events-town-view.ts` -> `lib/event-day-view.ts`): ett antal på startsidan kan inte skilja sig från /events/.
2. **Svaret först:** "N things on today" (HeroStat) + dagremsa (DayStrip, tappbar, antal som stora siffror, "–" för tom dag) direkt under H1. /events/: första dagen låg på y 1462-1522, nu syns hjälte och dagremsa utan scroll i 390 px. Startsidan: hjälten sitter direkt efter QuickLinks, före marquee/lead.
3. **EventDayList/EventRow:** en dagrubrik per dag, tid stor i fast kolumn, kategorifärg (kantlist) + ikon under tiden, titel i serif, `venue · område` på en rad, Pill Free / Kids & families / Teens, ↻ för weekly/monthly. Ingen "Around town"-etikett skrivs ut. Dagens toppobjekt (>=3 rader den dagen) får riktigt foto (eget foto eller venuens, aldrig generisk kategoribild) eller FallbackTile i kategorins färg.
4. **Dedup** (`DEDUPE_MINUTES = 60`): samma normaliserade titel + samma lokala dag + start inom 60 min = en rad. Testfall: de två riktiga SDSU Concert Choir Fall Concert-raderna 6 nov (19:00 och 19:30 Central, båda 7 nov i UTC) + story/arts-par + negativa fall (90 min, annan dag, annan titel).
5. **Startsidan:** Today / This weekend / This week (helg- och veckodagar inte dubbelräknade, `homeBlocks`), Coming up (5 rader, `showDate`), Worth knowing = möten som datarader (`MeetingLine`: organ, typ-Pill, datum/tid, "N agenda items", Agenda-länk), valda av regel (`selectWorthKnowingMeetings`: verkligt möte med agenda inom 21 dagar, ej quorum/cancelled/postponed, ej ihopvikt organ, max 3). Möten finns bara där (eventblocken är bara events), och ett möte som redan är startsidans lead upprepas inte.
6. **Moreno-tidszonsbuggen:** fixtur kring event-327253 (19:00 PST = 11 nov 03:00Z). Testet faller med UTC-dagsmatematik (3 fall röda, kontrollerat) och går med lokal. Datumrubrik, dag-gruppering, tonight/today räknas på stadens lokala dag.
7. **Free:** källans strukturerade kostnadsrad avgör först (`meta.cost` "Free…", "Free, ticket required" = gratis, "£…" = inte gratis); venueregeln `isFreeEvent` bara när källan inte gav någon. **Obs:** fältet heter `meta.cost` i `stories`, inte `tickets` (det namnet finns inte i databasen). Kids: Glasgows tag "Kids & families" där den finns, annars `isKidsEvent`. Teens bara om `meta.audience` säger det.
8. **Postponed** i mötesvyn: `isPostponed(raw)` med samma källfältsregel som Cancelled (dokumenttitel, status, kommentar, mötesnamn, aldrig agendatext), Pill "Postponed", överstruken tid, ingen .ics/agenda/"Next up", RSS "Postponed meeting:". Test.

## Beslut och skäl
- AI-text bort från startsidan: WeeklyRoundup borttagen från startsidan (beslut 5), Worth knowing är datarader. Alert- och handplockade rader som tidigare kunde stå i Worth knowing visas inte längre där (CityStatus tar aktiva larm).
- Announcement/new_in_town_digest-berättelser, som förut låg i Today/This week-floderna, syns inte längre i dessa block (bara via lead/secondary om de väljs).
- Kategori per event är en titelregel (`lib/event-category.ts`, 7 kategorier, null = neutral kant). Gissar aldrig från berättelsetexten.
- Sidan skriver aldrig ut berättelsens text (se buggen nedan).

## Fynd som kräver ditt beslut
1. **Moreno-bugg, orsak:** den lagrade AI-texten nämner UTC-dygnet. 72 av 150 kommande Moreno-event vars lokala dag skiljer sig från UTC-dagen har text som bara nämner UTC-datumet (t.ex. event-67503: 16:00 PST 7 dec, texten säger "December 8"). Nya /events/ och startsidan skriver inte ut texten, men `/s/<slug>/`, `/today/`, `/events/<facett>/` och StoryCard gör det fortfarande. Förslag (kräver ditt ja, rör live-DB): antingen sluta skriva ut berättelsetexten på de sidorna (följer beslut 5) eller regenerera de 72 texterna. QA-rad: `events.text-names-utc-day` i qa/checks.json (ej körtidskontroll ännu, behöver DB-läsning i qa/).
2. **Broomfield har 0 kommande event** i databasen: både /events/ och startsidan visar tomt läge ("Nothing on the calendar yet this week."). Layouten är verifierad på Moreno, Brookings och Glasgow. Broomfield kan inte visas fylld förrän en eventkälla finns.
3. **Startsidan är inte klar:** TopEventCard/MarqueeCard (Ticketmaster), LeadStory/SecondaryStory (berättelsekort, delvis AI-skrivna), rail-Tiles (väder, trafik, priser), "More from"-paneler och QuickLinks är kvar på gamla komponenter. Marquee ligger fortfarande mellan hjälten och dagblocken. Föreslagen nästa omgång: väder-Tile -> HeroStat, marquee -> Card/FallbackTile, lead/secondary -> datarader utan AI-brödtext.
4. **Brookings Fall Choral Concert vs SDSU Concert Choir Fall Concert** (6 nov 19:00, samma sal) har olika titlar och slås därför inte ihop. Om det är samma konsert är det en matchning på plats+tid, inte titel; säg till om du vill ha den regeln (risk: två riktiga event i samma sal).
5. Brookings Worth knowing visas inte idag (inget möte med agenda inom 21 dagar utanför lead). Glasgow visar tre rader. Broomfields nästa möte är startsidans lead och upprepas därför inte.
6. "Also listed by …" (källhänvisning vid ihopslagna källor) skrivs inte längre ut i listraderna; de ihopslagna objekten sparas på raden (`merged`) om du vill visa det.
7. Facettsidorna (/events/free/, /events/kids/ …) och /today/ är kvar på StoryCard; de bör få samma EventDayList nästa.

## Ändrade filer
Nya: `lib/event-day-view.ts` (+test), `lib/event-row-facts.ts` (+test), `lib/event-category.ts` (+test), `lib/events-town-view.ts`, `components/events/{EventRow,EventDayList,EventsGlance}.astro`, `components/meetings/MeetingLine.astro`. Ändrade: `pages/events.astro`, `pages/index.astro`, `components/ui/DayStrip.astro` (länkar, stora siffror), `lib/ui/icons.ts` (repeat), `lib/meetings-view.ts` (+test: isPostponed, selectWorthKnowingMeetings), meetings-komponenterna, `lib/ui/standard-layout.test.ts`, `qa/checks.json`.
