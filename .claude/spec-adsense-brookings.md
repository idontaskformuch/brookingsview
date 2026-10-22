# AdSense-genomgång Brookings + förslag på bestående sidor (2026-10-22)

Ägarorder (klistrad 2026-10-22, går före Glasgow-utfyllnaden): Brookings ska bli godkänd för AdSense först (inte Moreno,
som enligt memory väntar 4-6 veckor). Gör genomgången per sidtyp, markera tunna/identiska-på-andra-sajter, föreslå
(1) noindex-typer och (2) bestående originalsidor: game day-guide per hemmamatch, Hobo Day-guide, universitetskalendern
för stan, föräldraguide, Jackrabbits i siffror ur egen data, campus öppet för allmänheten. Inga SDSU-logotyper/varumärken.
RAPPORTERA, BYGG INGET. Grundregel (CLAUDE.md): varje sida besvarar en konkret invånarfråga, annars noindex.
Mediavine Journey nämnd som parallell väg (1 000 sessioner/mån, GA4 krävs): GA4 laddas aldrig idag (samtycke förinställt).

## Mätning (lokalt Brookings-bygge 2026-10-22, dist + sitemap-0.xml)
642 byggda sidor, 110 indexerbara (alla i sitemap), 485 /s/-sidor varav bara 14 indexerbara (veckosammanfattningar).

| Typ | Sidor (indexerbara) | Mediantext | Natur |
|---|---|---|---|
| /facilities/<anl> | 40 | 131 ord | datadrivet, handkuraterat, adress/tider från officiella sidor |
| /this-week/<vecka> + /s/weekly-* | 15 + 14 | 649 / 529 | AI-ingress + sammanställd eventdata |
| /events/ + 6 facetter (campus, free, kids, library, past, this-weekend) | 7 | 1 423-2 366 | aggregerade eventlistor |
| /jobs/ + 3 kategorisidor | 5 | 359-2 277 | Adzuna (880 rader), identiskt på hundratals sajter |
| /city-hall/ (+archive, 2 projects, projects/) | 5 | 247-2 741 | mötessammanställning + eget projektregister |
| /university/ | 1 | 2 823 | SDSU-event + sport, skrapat |
| /jackrabbits/ | 1 | 2 892 | spelschema/resultat (skrapat) |
| /today /weather /traffic /closures /farm-report | 5 | 109-308 | NWS/SD511/USDA, tunna, finns överallt |
| /vote /election-results | 2 | 96-480 | eget kuraterat (vote) / datalänk |
| förtroende (about, contact, privacy, terms, cookies, corrections, editorial-policy, how-we-gather-this, advertising) | 9 | 105-651 | krävs, ej "innehåll" |
| övrigt: /, /offline (69 ord!), /play (98), /whats-on/ | 4 | 69-1 021 | |
| redan noindex: 471 /s/-sidor (event 271, meeting 108, alert 14 ...), 48 /whats-on/<slug>, columns, editorials, recipes, reviews | 535 | | |

## Förslag 1 -- noindex (bort ur sitemap)
Säkra: /jobs/ + alla /jobs/category/* (Adzuna-aggregat), /events/ facetter + /events/past, /offline, /play.
Sannolika: /traffic, /closures, /weather, /today (liveverktyg, 100-300 ord, finns hos NWS/SD511/lokala) -- användbara för
läsare men inget granskaren ser som eget värde; behåll i nav, noindex,follow. Äldre /this-week/<vecka> (behåll senaste 2).
Tunna facilities: de av 40 som saknar eget tillägg (se guide 9) -- noindex tills de berikats.
Resultat: ~110 -> ~45 indexerbara sidor, de som är kvar är det bästa vi har.

## Förslag 2 -- bestående originalsidor (alla ur officiella källor, länkade, faktagranskade; robots/villkor först)
Brookings/SDSU (ägarens lista), med vad vi redan har data till:
1. Game day-guide per hemmamatch (avspark, parkering, tailgating-regler, väder vid avspark, avstängda vägar, öppet i stan)
   -- sports_games + NWS + SD511 finns; parkering/tailgating måste hämtas ur SDSU/Jackrabbits officiella sidor (kolla villkor).
2. Hobo Day-guide (bestående, uppdateras årligen: paradväg, schema, historia, avstängningar, parkering) -- Hobo Day-datum härleds redan ur kalendern.
3. Universitetskalendern för stan (inflyttning, examen, lov: trafik, hotell, restauranger) -- SDSU:s akademiska kalender + vår university-data.
4. Föräldraguide: inflyttning, examen, familjehelg (boende, parkering, var man äter, vad som är öppet).
5. Jackrabbits i siffror ur egen data (säsonger, resultat, hemma/borta, publiksiffror om de lagras -- kontrollera) -- ingen annan har vår historik; växer med tiden.
6. Campus öppet för allmänheten (konstmuseet, McCrory Gardens, konserter) -- matar Free Things To Do.
Stadsguider (invånarfrågor):
7. Hur Brookings stadsfullmäktige fungerar och hur du följer det (mötesdagar, agenda, hur man yttrar sig) -- vi har möten + källor.
8. Sophämtning och grovsopor (kalender, regler, vad som tas emot) -- stadens sida.
9. Berika facilities: "vad är det, kostar det, tillgänglighet, parkering, bästa tid" per anläggning (gör de 40 sidorna värda indexering).
10. Parker och grönområden -- vad finns var, öppettider, regler.
11. Tillstånd och blanketter: bygglov, evenemangstillstånd, husdjur -- vem, hur, avgifter, länkar.
12. Vinterguide: snöröjning, snöberedskap, avstängningar (matar closure watch) -- stadens snöregler.
13. Brookings i siffror: befolkning/bostäder/väder ur offentliga källor (Census m.fl.), med "vad betyder det".
14. Mötesbeslut-årsöversikt (kvartalsvis): vad stadsfullmäktige beslutade, ur vår meetings-data -- unik först med historik.
15. Byggprojektens utveckling (city-hall/projects): växer med tid; fortsätter i bakgrunden (ägaren: unik först efter ett års data).
16. Ny i stan: praktisk checklista (el/vatten/skola/bibliotek/körkort).
Regel: inga SDSU-logotyper/varumärken, bara namn och fakta; AI-text bara efter faktagranskning mot källa; spärrar (inga namn på privatpersoner).

## Öppna frågor till ägaren
- GA4/AdSense-ordning: Brookings först; Moreno-review rörs inte före 4-6 veckor efter Phase A/B (memory).
- Vilka av 1-16 bygger vi först (förslag: 2, 1, 7, 8, 9 -- störst sökvolym/egen data)?
- Noindex-listan ovan: godkänn innan något ändras.
