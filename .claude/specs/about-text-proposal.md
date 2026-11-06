# Förslag: ny text för about + how-we-gather-this (2026-11-06) -- ÄNDRAT INGET, väntar ägarens ja

Skriven för: läsare av sajterna (invånare), inte utvecklare. Engelska, eftersom sidorna är engelska.

## 1. Vad som är fel idag (verifierat mot koden 2026-11-06)

| Påstående på sajten | Sanning idag | Var |
|---|---|---|
| "refreshed every 6 hours" / "checks the sources every 6 hours" | Skrapningen körs två gånger per dygn (11:00 och 23:00 UTC via cron-dispatchern; källor med egen `refresh_minutes` hoppas över om de körts nyligen). Vädret hämtas varje timme av en Worker. Sajten byggs om vid ny data och vid kodändring. | how-we-gather-this, about, GB-about, llms-about.ts, index.astro:529 ("This page rebuilds every 6 hours"), calendar.ics.ts-kommentar |
| "a language model turns raw agendas, calendars … into readable pages" / "An AI language model summarizes new items" | Ingen modellskriven berättelsetext visas längre (lib/ai-text.ts, beslut 2026-11-05/06). Titlar byggs av kod (publish.py build_title) ur källans fält. | how-we-gather-this, about, GB-about |
| "never altered beyond the plain-language summary" | Ingen sammanfattning visas. Fälten visas som källan angav dem; vi räknar ut avstånd, datum/tid i stadens zon, dubbletter och kategori (regler på titel, aldrig modell). | about, GB-about |
| Avsnittet "Reviews, recipes, editorials, and columns … written by the same AI model" | Texten visas inte. Gäller Brookings och Moreno (contentTrackRetired saknas där). | how-we-gather-this |
| "Every item links to its original source" | Stämmer för listrader (länk till vår sida med text, annars källan). Tonight/"Big shows" länkar till Ticketmaster. | about |

**Modellskriven text som FORTFARANDE visas (inte berättelser, andra tabeller) -- ägaren bör besluta:**
1. Marquee-"deck" (event_deck_digest.py): en AI-rad under stora Ticketmaster-evenemang på startsidan och /whats-on/ (US-städerna).
2. Closure Watch-prosa (closure_watch_digest.py): ett AI-stycke på /closures/ när läget är "watch".
3. Free-teasers (free_teasers.py): en AI-rad/-stycke per gratis event och per bibliotek/park/kulturhus på /events/free/.
4. Projektsidornas "what changed"-rad (project_threads.py, `synthesis`) på /city-hall/projects/<projekt>/.

Rekommendation: ta bort dessa fyra på samma sätt (publicBody-mönstret, ingen DB-skrivning) så att texten nedan blir sann utan förbehåll. Om de behålls: använd stycket "OM DE FYRA BEHÅLLS" nedan i stället.

## 2. Förslag: /how-we-gather-this/ (alla städer)

> **How we gather this**
>
> {Site} has no newsroom. It collects public information from the sources listed below, checks them twice a day, and shows what they publish: dates, times, places, agenda items, notices and links. We don't write news stories, and no model-written text is shown on the site. No person reviews an item before it appears; the checks described below run automatically.
>
> **The sources**
> (generated list, unchanged) This list is generated from the same configuration the collectors run from. If a source is switched off it drops off this page on the next build.
>
> **How often**
> Event calendars, meeting agendas, school and public notices are collected twice a day. Weather is updated every hour. Each page says when it was last updated. A change at the source can take up to half a day to show here; for anything time-critical, use the link to the source.
>
> **What we show**
> - **Meetings:** the date, time and place, the agenda item titles exactly as the agenda gives them, and links to the agenda, minutes and video. A meeting is marked Cancelled or Postponed only when the source itself says so in a status or notice field.
> - **Events:** the title, date, time and venue as the organiser published them, with a link back to the organiser. "Free" and age labels appear only when the source states them.
> - **Weather and alerts:** forecasts and warnings from {NWS / the Met Office}, shown as published.
> - **Traffic, school closures and public notices:** the notices as the road authority or the school district posts them, with a link.
> - **Big shows nearby** ({Broomfield only}): concerts, sports and touring shows from Ticketmaster at venues within 25 miles. They are listed separately and are never counted as events in town. Prices are not shown.
>
> **What we work out ourselves**
> Software, not a model, converts times to {town}'s time zone, removes duplicates between sources, sorts events into groups from the source's own category or keywords in the title, and measures straight-line distance from the town centre (shown as "Denver · 13 mi"; it is not a driving distance). Where the source gives no value, we show nothing rather than guess.
>
> **What we leave out**
> (unchanged: private individuals are named by role; we don't cover arrests, court records or obituaries.)
>
> **Sources we do not read**
> If a source's robots.txt forbids automated reading, or it blocks us, we don't collect from it. We show a plain link to it instead, and never try to get around the block.
>
> **Photos**
> (unchanged, plus: Ticketmaster images appear on its own listings.)
>
> **Corrections**
> (unchanged.)

**OM DE FYRA BEHÅLLS** (ersätter meningen "no model-written text is shown" och lägger till ett avsnitt):
> **Where an AI model is still used**
> A few short passages are written by Claude, an AI model made by Anthropic, from the source text alone, and are labelled as AI-written where they appear: {the one-line description under a featured concert; the background paragraph on a school-closure watch; the one-line descriptions on the free-things page; the "what changed" line on a project page}. Everything else on the site is shown as the source published it.

## 3. Förslag: /about/ (US) -- "How it is made" och "Sources"

> **How it is made**
> Software checks the sources listed below twice a day (weather every hour) and shows what they publish: dates, times, places, agenda items, notices, each linked to the original. We don't write news stories and no model-written text is shown. Items go live without a person reviewing each one, and no one reports from the ground. Read the full, source-by-source breakdown on how we gather this.
>
> **Sources**
> Everything on this site traces back to one of these, checked on a schedule and shown as the source published it:

(Corrections-stycket: "Automated summaries occasionally get something wrong" -> "The software occasionally gets something wrong, for example a time zone, a duplicate or a source that changed after we read it. Errors are corrected as soon as they're reported ...".)

**GB (components/legal/gb/AboutBody.astro):** samma tre ändringar, med brittisk stavning ("organiser", "summarise" försvinner).

## 4. Övriga ställen med samma fel (föreslås ändras samtidigt, efter ja)

- `lib/llms-about.ts`: "Refreshed every 6 hours." -> "Collected twice a day; weather hourly."
- `pages/index.astro:529`: "This page rebuilds every 6 hours." -> "This page is rebuilt when new information arrives."
- `pages/news-sitemap.xml.ts`, `TodayBlock.astro`, `OrientationHeader.astro`, `city-hall/calendar.ics.ts`: bara kodkommentarer ("6 hours"), rätta i samma svep.
- `editorial-policy.astro` och `corrections.astro` nämner också sammanfattningar -- kontrollera mot den här texten före ändring (inte läst i detalj än).
