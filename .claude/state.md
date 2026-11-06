# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md)

## Nu: PREMIUM Fas 4 PUSHAD + live (78e7e00). AI-text-bort (steg 3) LOKALT COMMITTAT, EJ PUSHAD. Batteri grönt (vitest 2268, pytest 1239, astro check 0, build x4 exit 0, disjoint OK 77/113/39/25; Brookings 88->77 och Moreno 116->113 i sitemap = AI-berättelser nu noindex). Nästa: ägarens svar.
- Fas 4 live-smoke 2026-11-06: / och /events/ x4 i 390 px = 200, scrollWidth 390; nya raderna (.ev-li) renderas på Brookings, Moreno, Glasgow; Broomfield 0 rader = tomt läge (se nedan).
- BROOMFIELD 0 EVENT, ORSAK (läst, inget ändrat): data_sources.events är enabled:false (ägarbeslut 2026-10-08, kommentar 2026-11-04) och alla 7 källor kind:blocked: 4 broomfield.org-iCal (robots.txt spärrar /common/modules/icalendar/ sedan 2026-10-21), WebTrac (Cloudflare 403), compass (robots Disallow /), chamber/BizWest (ägaren avstod). scrape_runs har ALDRIG en rad med source_key 'events' för broomfield_co (Brookings 396, Moreno 321, Glasgow 15). events-tabellen: 14 rader, alla nws_alert, senast 2026-11-02, 0 kommande. Inget fel/format att fixa: ingen tillåten källa finns. Broomfield /whats-on/ har ~445 Ticketmaster-länkar (hämtas vid bygget, ej i DB). Fix är inte liten: (a) länka /events/ -> /whats-on/ i tomt läge, (b) mata Ticketmaster in i den delade pipelinen (events-town-view), (c) ny tillåten källa. VÄNTAR på ägarens val.
- STEG 3 (AI-text bort): site/src/lib/ai-text.ts (isAiText = generated_by börjar 'ai:', publicBody). Kopplad i StoryCard, LeadStory, WeeklyRoundup, s/[slug] (text, meta-description, JSON-LD), this-week/[week], university, jackrabbits, rss.xml. BESLUT OCH SKÄL: permalänkar vars text hålls inne är tomma skal -> noindex (shouldNoindexStory + spegeln i astro.config.mjs, annars bryts sitemap/noindex-disjoint) och ingen Article-schema (skulle beskriva text sidan inte visar). Inga DB-skrivningar, ingen regenerering. Test: ai-text.test.ts (faller om en layout läser story.body utan publicBody; föll på LeadStory/WeeklyRoundup först). qa-raden events.text-names-utc-day markerad löst.
- Ej täckt (utanför de fyra sidtyperna): llms.txt/andra .ts-utdata, meddelanden som egna kort; /s/-sidor för ~2000 AI-berättelser blir noindex (alla AI-typer, inte bara event).


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
