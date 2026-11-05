# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md)

## Nu: PREMIUM-PRESENTATION Fas 4 (events + startsida) KLAR LOKALT, EJ PUSHAD. Lista: .claude/review/phase4/REVIEW.md. Nästa: ägarens granskning.
- Pushat: 4b58b4c (Fas 3 docs). Lokala commits: de361c7 (/events/ + Postponed) + Fas 4-steg 2 (startsida, dedup, EventDayList, Worth knowing-meetings).
- Byggt: lib/event-day-view.ts (lokal dag, dedup 60 min, free/kids/teens, recurrence-enum, feature/caps/homeBlocks), events-town-view.ts (delad pipeline /events/ + startsida), event-row-facts/-category, components/events/*, MeetingLine, isPostponed, selectWorthKnowingMeetings.
- BESLUT OCH SKÄL: sidor skriver aldrig ut berättelsetexten (72/150 Moreno-rader med UTC-dygn i AI-texten, qa-rad events.text-names-utc-day); Free = meta.cost först (fältet heter cost, inte tickets), venueregel som reserv; WeeklyRoundup borta från startsidan (beslut 5); meetings bara i Worth knowing.
- Batteri: vitest 2264, pytest 1239, astro check 0, build x4 OK, disjoint 39/88/116/25. Skärmdumpar i .claude/review/phase4/ och gaps/ (INVENTORY.md).
- Kända luckor: Broomfield 0 event (tomt läge); marquee/lead/rail/QuickLinks kvar gamla; facettsidor och /today/ kvar på StoryCard.
- Nästa steg: ägarens svar på REVIEW.md "Fynd" 1, 3, 4; sedan /today/ + facetter på EventDayList, väder-Tile -> HeroStat.

## Verifierat 2026-11-05 (Worker-uppgifter från förra steget)
- Worker viewmedia-cron-dispatcher version 3260ae2b deployad 16:04 UTC; första hourly-tick efter deploy 17:00 UTC: outcome ok, inga exceptions, alla fyra städer ok (loggar via wrangler tail).
- weather_snapshots.payload har fetched_at för alla fyra (17:00-17:01 UTC). US-städer: pop/feels/gust 24/24 timmar (gridpoints funkar), uv/precip_mm 0 (väntat). Glasgow: pop, feels, gust, uv, precip_mm 24/24.
- Live /weather/ i 390 px x4: 200, scrollWidth 390, "Updated" syns, regnstaplar (ui-hr__rain/pop) renderas. Konsolfel: 1 ERR_FAILED på US-sidorna = mina egna avbrutna analytics-anrop (QA-trafik blockeras, regel 12), 0 på Glasgow.
- BESLUT och SKÄL: weather_snapshots har EN rad per stad och UTC-dygn (upsert, created_at ändras aldrig) -> created_at säger inget om färskhet, använd payload.fetched_at.
- PUSHAD: 4e0e9d8 (origin/main = HEAD).

## Fas 3-fynd (detaljer i proposal-filen)
- Moreno 0 kommande: scrapern OK (daglig, 14 poster/körning), källan tom: eSCRIBE publicerar bara 4-7 d före mötet. Nästa rådsmöte ca 2026-11-17. Tomt läge är normalläge.
- Moreno: raw_data.Location har U+FFFD (tankstreck tappat), agenda_url = '' på alla 36 rader. Brookings BODIES saknar 6 organ som finns i databasen. Broomfield: enda publika agendavyn är sandbox (spärrad).
- Dedup: Brookings 31 av 134 rader är Notice of Quorum; Joint Board of Adjustment 2026-11-04 slås ihop; Broomfield 2026-12-01 Regular + Transition samma tid slås INTE ihop (fråga).

## Öppna frågor till ägaren (Fas 3)
1. Broomfield officiell agenda-URL (sandbox får inte länkas). 2. Broomfield Transition Meeting 12-01: behåll eller dölj. 3. Glasgow: dölj Local Negotiating Committee for Teaching Staff? 4. Notiser: A (RSS) + B (.ics) i Fas 3, e-post senare? 5. Moreno Location-tecken och agenda_url ingår i Moreno-bygget.

## Kvar / öppna spår
- Moreno kvällsevents datum en dag fel (tidszon): beslut 10, ej gjord.
- AI-prosa bort överallt (beslut 2026-11-05); Fas 5 = ny /this-week/.
- Högtidssidor: omkontroll ca 2026-11-18 och 2026-11-23 (supervised).
- AdSense-mål = Broomfield (GSC-export saknas). Broomfield verifieras först.
