# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md)

## Nu: AI-text-komplettering + Broomfield tomt läge KLARA lokalt, batteri grönt (vitest 2271, pytest 1239, check 0, build x4 exit 0, disjoint OK 77/113/25/39 = oförändrat). Pushas + live-smokas nästa. Steg 5 (TM 'Big shows nearby') = bara designförslag, väntar ägaren.
- Live-smoke Fas 4 2026-11-06: / och /events/ x4 i 390 px = 200. Broomfield 0 event: data_sources.events enabled:false, alla 7 källor blocked (robots/Cloudflare/ägarbeslut), events-tabellen bara nws_alert.
- AI-TEXT (beslut 2026-11-06, ägaren): lib/ai-text.ts: isAiText, publicBody, ownPageHref (null för AI), linkTarget (egen sida -> source_url -> null). BESLUT/SKÄL: /s/-sidor för AI-text är tomma skal (noindex) -> inget får länka dem; listrader faller tillbaka till källlänk eller ren text. Täckt: StoryCard/Lead/Secondary/TopEvent/Related, events-listor (itemLink), TodayBlock/weather (alert -> /weather/), meetings (story_slug bara icke-AI i SQL), university/weeks, home-sales/archive/month, this-week, facilities, ICS-beskrivning, JSON-LD description, RSS (AI-poster bort -> flödet nästan tomt), news-sitemap (filtrerar AI/noindex), llms.txt/llms-about (påstår ej längre AI-skrivna sammanfattningar), whats-on AI-intro avstängt, workplace-watch 'Read more' borttagen. Vakttest i ai-text.test.ts (storyHref-allowlist).
- Ej ändrat, ägarbeslut: how-we-gather-this.astro och about.astro säger fortfarande att Claude sammanfattar -> stämmer inte längre. index.astro:630 project-update-text (u.body) ej story, ej rörd.
- Broomfield tomt läge: EventsGlance tomma grenen länkar /whats-on/ ('Concerts and shows in the region: What's On').
- KOMMANDE: Palisade-adaptern byggs feb-mars 2027. Nej: Patch, Eventbrite, MaxPreps, Bandsintown. Väntar mejlsvar/egen kontroll, bygg inget: bryggerier, Broomfield Symphony, Community Players.
- NÄSTA SESSIONER (ägaren 2026-11-06): eventkälle-inventering, EN stad per session, läs bara: Glasgow -> Moreno -> Brookings (Broomfield klar). Leverans .claude/specs/event-sources-<stad>.md (10 kategorier, rangordnad tabell, topp 5, stängda-men-mejlvärda). Kolla Localist, Simpleview; Glasgow även Skiddle, Data Thistle.

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
