# Kuraterat register, förslag för godkännande (2026-10-29)

Status: FÖRSLAG, inget byggt, ingen extraktion körd, ingen tabell skapad (steg 6, kräver ägarens ja; migration + live-skrivning = regel 7).
Robots lästes 2026-10-29 med UA "ViewMediaBot" (redirects följda). Regel (ägaren 2026-10-28): utesluts om robots nämner GPTBot/ClaudeBot/anthropic-ai/CCBot/Google-Extended/PerplexityBot ELLER `User-agent: *` har `Disallow: /`.
"Skäl" = vad ställets kvällsutbud väntas vara. Hämtat ur allmän kännedom och sökträffar, INTE verifierat mot ställets egen sida; extraktionen (steg 6) bekräftar eller stryker varje rad.

## Glasgow (15 förslag, mål 15-30)
| # | Ställe | Typ | Skäl | Robots |
|---|---|---|---|---|
| 1 | The Stand Comedy Club | komedi | stå-upp flera kvällar i veckan | OK (bara /login, /account m.fl. spärrat) |
| 2 | Nice N Sleazy | bar/livemusik | livemusik och klubbkvällar | OK |
| 3 | King Tut's Wah Wah Hut | musiklokal | spelningar (mycket finns även på Ticketmaster) | OK (tom fil) |
| 4 | Barrowland Ballroom | musiklokal | spelningar (överlapp med Ticketmaster) | OK |
| 5 | SWG3 | klubb/musiklokal | klubbkvällar och spelningar | OK (bara /umbraco, /wwwroot spärrat) |
| 6 | St Luke's | musiklokal | spelningar (överlapp med Ticketmaster) | OK |
| 7 | Òran Mór | kultur/musik | musik, komedi, talat ord på kvällar | OK |
| 8 | Sub Club | klubb | klubbkvällar | OK |
| 9 | Drygate Brewery | bryggeri/bar | kvällsevent (quiz m.m., ej verifierat) | OK |
| 10 | The Horseshoe Bar | pub | karaoke/pubkvällar (ej verifierat) | OK |
| 11 | Cottiers | teater/musik | kvällsföreställningar | OK |
| 12 | Tron Theatre | teater | föreställningar, komedi | OK |
| 13 | Citizens Theatre | teater | föreställningar | OK |
| 14 | Glasgow Film Theatre | biograf | kvällsvisningar | OK (glasgowfilm.org; gft.org.uk svarade inte) |
| 15 | Mackintosh Church | konsertlokal | kvällskonserter | OK |

Utesluts (robots nämner AI-botar): Mono (monocafebar.com), Sloans (sloansglasgow.com), Glasgow Art Club.
Ej bedömda (robots.txt gav inget svar/403): 13th Note, The Art School, Stereo, The Hug and Pint, The Variety Bar, Cathouse, CCA (403), The Clutha. Kan prövas igen med annan adress.
Glasgow Concert Halls (glasgowconcerthalls.com) har OK robots men är Glasgow Life/Ticketmaster-nära; föreslås INTE (dubblett av befintliga källor).

## Broomfield (4 förslag, under målet 15-30)
| # | Ställe | Typ | Skäl | Robots |
|---|---|---|---|---|
| 1 | 4 Noses Brewing (8855 W 116th Cir) | bryggeri | industrikväll mån, trivia tis, livemusik ons+lör (303 Magazine, odaterad) | OK (`Disallow:` tomt) |
| 2 | Wonderland Brewing (5450 W 120th Ave) | bryggeri | trivia och konstkvällar, dagar okända (Atmosfy) | OK |
| 3 | Nighthawk Brewery (2780 Industrial Ln) | bryggeri/pizza | spelrum, pinball; kvällsprogram okänt | OK |
| 4 | Big Choice Brewing (7270 W 118th Pl) | bryggeri | planerad vid sökningen; ÖPPEN? måste verifieras | OK |

Utesluts: broomfield.org (stadens egen sajt, inkl. auditorium och bibliotek) -- robots nämner GPTBot, ClaudeBot, Claude-SearchBot, PerplexityBot, CCBot m.fl. 1STBANK Center täcks av Ticketmaster. 100 Nickel / Chipper's: ingen robots.txt nåbar på de adresser jag prövade.
Slutsats: Broomfield når inte 15-30 inom stadsgränsen. Förslag: välj om grannorter (Westminster, Louisville, Lafayette) får ingå i registret, eller acceptera att registret bidrar lite i Broomfield (tröskeln avgörs då av Ticketmaster + egna event).

## Frågor till ägaren
1. Godkänns Glasgow-listan (strykningar/tillägg)? 2. Broomfield: bara de 4, eller även grannorter? 3. Sökväg för extraktionen = ställets egen hemsida, högst en hämtning per ställe och dygn, kontroll månadsvis, `checked <datum>` + källänk per rad, rad borttagen efter 7 dagar utan bekräftelse (spec) -- oförändrat.
