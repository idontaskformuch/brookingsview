# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md, sök "Fas 1 KLAR" / "Fas 2 (väder)")

## Nu: PREMIUM-PRESENTATION Fas 3 (möten) KLAR, PUSHAD c746af4 (origin/main = HEAD), live-smokad. Nästa: Fas 4 väntar på ägarens go.
- Ägarens tre ändringar gjorda i c746af4: (1) quorum utan riktig motsvarighet = "[Organ] – quorum notice" + Pill "Quorum notice", plats/tid, "Members may be present. No agenda posted."; hoppas över som "Next up" och i meta-description; testet för Brookings 9 nov uppdaterat. (2) Glasgow-grinden: Funding/Award/Awards i _PLACE_WORDS (uk_guardrails.py + uk-title-guard.gb.ts i lockstep), test + fixtur för båda titlarna; de 3 riktiga träffarna hålls fortfarande. (3) Cancelled: isCancelled(raw) i meetings-view.ts (dokumenttitel/status/kommentar från källan, aldrig fri agendatext), Pill "Cancelled" + överstruken tid, ingen .ics/JSON-LD/agenda, RSS "Cancelled meeting:"; fixtur site/src/lib/meetings-cancelled.fixture.json (Moreno 15129).
- BESLUT och SKÄL: "postponed" ingår INTE i cancelled (ägaren sa cancelled). Cancelled-detektion läser bara källans strukturerade fält, annars false positives på agendatext om uppsägningar. Ingen qa/checks.json-rad: ägarbeställd funktion, inte manuellt funnet fel.
- Batteri: vitest 2222, pytest 1239 (11 skipped), astro check 0, build x4 exit 0 (stadens id för Glasgow är "glasgow"), disjoint OK 88/116/39/25.
- Live-smoke 390 px: alla fyra /city-hall/ 200, scrollWidth 390, RSS application/xml + .ics text/calendar 200. Broomfield deployade ca 10 min efter de andra (404 först, sedan 200). Brookings visar "quorum notice" live; ingen avbokad kommande rad finns live ännu (Moreno 3 nov är passerad).
- Kvarstår från REVIEW.md: Fas 4 ej påbörjad. Granskningslistan punkt 1 och 3 är nu lösta.

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
