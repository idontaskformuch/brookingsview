# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md, sök "Fas 1 KLAR" / "Fas 2 (väder)")

## Nu: PREMIUM-PRESENTATION Fas 3 (möten) BYGGD alla fyra städer, batteri grönt, väntar på ägarens granskning (.claude/review/phase3/REVIEW.md). Ej pushat.
- Spec .claude/specs/premium-presentation.md (Fas 3), förslag .claude/specs/phase3-meetings-proposal.md, regler .claude/standards.md.
- Alla fyra klara. Skärmdumpar före/efter .claude/review/phase3/ (390 px, ljust/mörkt). Batteri: vitest 2221, pytest 1237, astro check 0, build x4, disjoint OK.
- Delat bygge (i Broomfield-commit): config/meetings.ts (+config/gb/meetings-glasgow.ts) per-stad BODIES/hidden/groupRules/portal; lib/meetings-view.ts (källor legistar/agendalink/escribe/coins, quorum-regeln, dedup-nyckel datum+organ+typ), lib/meetings-data.ts, uk-title-guard.gb.ts (port av uk_guardrails), sandbox-url.ts, MeetingCard/MeetingsUpcoming(HeroStat, Chips, EmptyState)/MeetingsFollow, RSS (/city-hall/rss.xml, /city-hall/organ/<k>/rss.xml), .ics (/city-hall/calendar.ics, calendar/organ/<k>.ics), QA-kontroller web.replacement-char, web.empty-link, meetings.unknown-organ (fixtur tests/fixtures/qa_meetings_2026-11-05.json).
- BESLUT och SKÄL: Broomfield agenda-länk = https://broomfield.org/4079/Broomfield-Council-Meetings (verifierad med ett läsande anrop, pekar på stadens portal; sandbox länkas aldrig). Glasgow-titlar går genom TS-port av UK-grinden (5 av 166 hålls), listor låsta mot Python av test. Quorum utan riktig rad samma dag+organ visas som mötet ("Agenda not yet published"), utan .ics/JSON-LD.
- FYND: Moreno U+FFFD finns INTE i databasen (35 av 36 har riktig tankstreck) och agenda_url är '' på 14 av 36, inte alla; bygget ändå försvarar båda (cleanLocation, tom länk = ingen länk) + QA-kontroll.
- Nästa: ägaren granskar REVIEW.md (12 punkter), sedan push-beslut.

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
