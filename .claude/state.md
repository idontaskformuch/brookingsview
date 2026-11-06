# State (komprimerad 2026-11-05; Fas 1+2 detaljer i .claude/state-archive.md)

## Nu: AI-text i egna tabeller BORTA + about/how-we-gather omskrivna (ägarens ja 2026-11-06). Batteri grönt (vitest 2299, pytest 1239, check 0, build x4 exit 0, disjoint 77/113/39/25). Pushas + live-smoke (about, how-we-gather, /closures/, /events/free/, /rss.xml x4) = nästa steg.
- AI-TEXT BORT (alla fyra, ingen DB-skrivning, generatorerna i ai_pipeline orörda): marquee-deck (TM-raden, index+whats-on; kortet visar venue/datum/TM-titel), closure-watch-prosa (/closures/ har kvar den hårdkodade Watch-mallen), free-teasers (stories-raden borta; facility-raden = mallmening 'Library in Stad — adress.'), projektsidornas 'what changed' (rubrik = agenda_title). Borttagna ur db.ts: getEventDeckDigests, getClosureWatchProse, getWhatsOnIntro, free_teaser-kolumner, synthesis. VAKTTEST (ai-text.test.ts): ingen src-fil får nämna event_deck_digest/closure_watch_prose/whats_on_intro/free_teaser/synthesis.
- TEXT: how-we-gather-this, about, GB-about, llms-about omskrivna enligt .claude/specs/about-text-proposal.md (utan avsnittet 'Where an AI model is still used'). Frekvens: 2x/dygn (11:00+23:00 UTC), väder varje timme. '6 hours' rättat i index.astro, site-config (3 meta), kodkommentarer. EJ ÄNDRAT, har samma gamla AI-påstående: terms, GB-terms, editorial-policy, advertising.astro:95, corrections, city-hall.astro:45 (ledetext 'summarized'), meta-description city-hall-archive/workplace-watch. Föreslå nästa.
- GLASGOW RSS 'TOM': stämmer inte. Lokalt bygge 18 poster, live 18 (6 agenda + 12 events). Tom är BROOMFIELD (0 poster, känt: ingen agenda-publiceringsdatum, ingen eventkälla).
- BIG SHOWS (ägaren 2026-11-06): config siteConfig.bigShows {enabled,maxMiles} (Broomfield 25). lib/big-shows.ts (buildBigShows/getBigShows, andra TM-anrop på radien 25), components/events/BigShowsNearby+BigShowRow, bara på /events/ (startsidan har redan Marquee, ingen teaser). Datumsorterad, sport med, inga chips, pris dolt, 10 rader + fäll till max 40, sedan länk What's On. Serier (samma titel+venue) = en rad '+N more dates'. Hålls utanför lokala pipelinen (test läser källfiler). SKÄL cap: 488 shows/60 d.
- TONIGHT: där bigShows.enabled räknas TM-rader inte i 'N things on tonight', scope-raden eller 'Next up' (partitionBig, delas av sida och klient); egen rad '+ N big shows nearby'; varje TM-kort 'Stad · N mi' (bigShowLabel, även hemstaden). Glasgow/Moreno oförändrade (bigShows saknas).
- RSS /rss.xml: lib/site-feed.ts, bara fält: agenda publicerad + cancelled/postponed möten (FeedItem.kind), skolavstängningar (school_alerts, 14 d), max 5 lokala event/vecka (buildTownEventsView, aldrig TM). Broomfield-flödet tomt (AgendaLink ger inget publiceringsdatum, ingen eventkälla). Ej gjort: cancelled/postponed för EVENT (källdata saknas).
- AI-TEXT i berättelser bort pushad+live (4e85c18): lib/ai-text.ts, vakttest; AI-sidor noindex-skal.
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
