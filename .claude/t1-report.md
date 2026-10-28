# T1-utredning (omgång 2a) -- rapport 2026-10-28

Ren utredning. Ingen kod i repot, inga skrivningar mot live-DB (events lästes i en READ ONLY-transaktion med rollback). Skript och rådata (t1_osm.py, t1_osm2.py, t1_db.py, t1_tm.py, t1_probe.py, *.json) ligger i sessionens scratchpad, inte i repot.

## 1. OSM (Overpass, radie från centrum: Glasgow 7 km, Brookings 8, Moreno 9, Broomfield 9)
| stad | pub | bar | nattklubb | musiklokal | teater | evenemangslokal | med webb | med öppettider |
|---|---|---|---|---|---|---|---|---|
| Glasgow | 308 | 134 | 20 | 3 | 23 | 15 | 188 av 530 (35 %) | 114 (22 %) |
| Brookings | 5 | 9 | 0 | 0 | 0 | 1 (+5 kasinon) | 4 av 20 | 0 |
| Moreno Valley | 0 | 0 | 0 | 0 | 1 | 1 | 0 av 2 | 0 |
| Broomfield | 14 | 20 | 0 | 0 | 7 | 2 | 25 av 47 | 20 |

OSM räcker som ställesregister bara i Glasgow. Brookings och Moreno har nästan inget kartlagt -> kuraterat register för hand.
Grannstäder: Sioux Falls (17 barer, 4 pubar, 6 teatrar), Riverside (15 barer), Temecula (8 barer, 6 pubar), Boulder (13 barer, 12 pubar, 14 teatrar), Denver (245 barer, 89 pubar, 22 nattklubbar, 22 evenemangslokaler).

## 2. Stickprov, 10 ställen/stad (startsida + robots.txt, en hämtning vardera, UA ViewMediaBot)
Stickprovet drogs ur ställen MED webbadress i OSM (Brookings + Sioux Falls, Moreno + Riverside, Broomfield + Boulder).
- schema.org Event (JSON-LD) på startsidan: Glasgow 0/10, Brookings+Sioux Falls 0/10, Moreno+Riverside 1/10 (Riverside Municipal Auditorium, MusicEvent), Broomfield+Boulder 1/10 (Rembrandt Yard, Event). Restaurant/BarOrPub-typer finns men bär inga event.
- iCal: Levitt at the Falls (Sioux Falls), Gravity Brewing (Broomfield). RSS-länkar på 1-5 per stad, men oftast WordPress-kommentarsflöden -- INTE verifierade som eventflöden.
- robots.txt: inget ställe förbjöd ViewMediaBot. Fem ställen blockerar AI-botar generellt (Loveable Rogue, Menagerie, Gravity Brewing, DJ's Watering Hole, Root Kava) -> läs ställets villkor innan det kommer in i registret.
- 6 av 40 oåtkomliga/felkod (timeout, 404, 429, 521).
- Slutsats: maskinläsbara event ~5 % (2 av 40). Huvudvägen blir löptext -> Haiku-extraktion med valideringsgate.
- Begränsning: bara startsidan hämtades; ställenas eventsidor ej provade.

## 3. Biljett-API:er
- Ticketmaster Discovery: redan i bruk, täcker alla fyra städer.
- Skiddle (UK): gratisnyckel via ansökan, men sidan säger "non-commercial use only; kommersiell användning kräver skriftligt godkännande". Om annonsfinansierad sajt räknas som kommersiell står inte; inget om attribution/cache; beta. Kontakt på sidan: api@skiddle.com (en sökträff sa dev@ -- verifiera). Skiddles täckning i Glasgow ej testad (kräver nyckel). Rek: fråga skriftligt innan något byggs.
- Eventbrite: publika event-sök-endpointen stängdes 2019-12-12 -> oanvändbar för upptäckt.
- Bandsintown: nyckel knuten till en artist, plattformsintegration kräver partnerskap -> nej.
- SeatGeek, Songkick, Dice: villkor kunde inte verifieras -> OBEDÖMDA, inte godkända.
- US utöver Ticketmaster: inget öppet gratis alternativ funnet.

## 4. Kvällsevent, 28 dagar framåt (start >= 17 lokal tid)
Egen events-tabell: Glasgow 43 (bara glasgow_life, 2 på kvällen); Brookings 72 (library 33 på kvällen, chamber 2); Moreno 277 (library 67, city_events 16 -- alla fre-sön, farm_house 4); Broomfield 0.
Ticketmaster (radie -> kvällsevent / kvällar med minst ett / lokaler):
- Glasgow 5 mi 297 / 29 / 42; 15 mi 297 / 29 / 43 (nuvarande val); 25 mi 308. ~10 per kväll. Rock 116, teater 33, komik 28, pop 21.
- Brookings 25 mi 5 / 5 / 3; 75 mi 33 / 13 / 14 (mest sport).
- Moreno 20 mi 67 / 21 / 9; 35 mi 168 / 23 / 21; 50 mi 463 / 28 / 53 (komik 109).
- Broomfield 10 mi 15 / 12 / 4; 20 mi 395 / 27 / 54; 35 mi 427.

## 5. Återkommande kvällar
Ingen maskinläsbar källa hittad. Löptext på startsidorna nämner: quiz/trivia (Old Schoolhouse, Mudrock's, Wooden Legs, Root Kava), open mic (Root Kava), karaoke (Menagerie), live music (Old Schoolhouse, Levitt, Icon Lounge, Mountain Sun), happy hour (Paramount, Wooden Legs, Menagerie, Waterloo, Root Kava). OSM live_music-tagg: 1 ställe i Glasgow, 0 i övriga. => Haiku-extraktion ur löptext (enligt spec T1) är enda vägen, med månadskontroll.

## 6. Förslag kuraterat register (15-30 ställen/stad)
- Glasgow: 25-30 ur OSM-ställena med webb (117 pubar/barer/nattklubbar/musiklokaler i poolen); musiklokaler veckovis, pubar månadsvis.
- Brookings: ~15, handplockade (OSM har bara 4 med webb): bryggerier, SDSU-nära, kasinon + Sioux Falls (Levitt, Icon Lounge, Wooden Legs, Eponymous, Paramount).
- Moreno: ~15 med Riverside (Municipal Auditorium, Worthington's) + stadens egna evenemang (city_events finns redan) + biblioteket.
- Broomfield: 20-25 Broomfield + Boulder (Mountain Sun, Gravity, Rembrandt Yard); Denver bara via Ticketmaster.
Uppdateringsfrekvens per ställe kan inte mätas förrän registret finns (ingen historik).

## 7. Radie
- Glasgow: 5-15 mi ger samma (297) -> 15 mi behålls.
- Brookings: 25 mi ger 5, 75 mi (Sioux Falls) ger 33 -> 60-75 mi, men tunt även där.
- Moreno: 20 mi ger 67 (räcker för /tonight, ~3/kväll); 35 mi (Riverside/Temecula) ger 168.
- Broomfield: 10 mi ger 15 (otillräckligt); 20 mi (Boulder/Denver) ger 395 -> 20 mi behålls.

## 8. Facebook/Instagram-bara
Stickprovet mäter inte detta (valt ur ställen med webbadress). Indikation: i OSM har Brookings bara 1 av 9 barer med webbadress och Moreno 0 av 2; OSM-taggar för "bara social länk" är 2-4 % i Glasgow men undervärderar. Bedömning: majoriteten av små barer i Brookings och Moreno saknar egen sida eller finns bara på Facebook. FÖRSLAG (inget byggs): "Add your event"-sida med moderering för Brookings och Moreno; kan vänta i Glasgow/Broomfield.

## 10. Happy hour, öppet sent, kaffe
- Happy hour maskinläsbart: 0 av 40. Löptext på startsidan: 5 av 40 (~12 %); menyflikar ej genomsökta. OSM happy_hours-tagg: Denver 29 restauranger + 9 barer, Broomfield 2, övriga 0.
- Öppet efter 22 (OSM-öppettid slutar >= 22/24/7): restauranger Glasgow 123, Sioux Falls 24, Brookings 6, Moreno 7, Riverside 43, Broomfield 34, Boulder 40; pubar+barer Glasgow 97, Broomfield 13. Öppettider alls: Glasgow restauranger 154/495, Brookings 9/35, Moreno 7/32, Broomfield 103/255.
- Kaféer med outdoor_seating / internet_access: Glasgow 66 / 51 av 473; Brookings 1 / 2 av 10; Moreno 0 / 2 av 14; Broomfield 14 / 15 av 64; Boulder 22 / 25 av 78.

## 9. Trösklar (minst 10 aktuella poster i minst 3 grupper)
"Aktuella" tolkas per kväll (osäkert, ägaren kan välja 28 dagar).
- /tonight: Glasgow JA (~10 TM/kväll, grupperna live music, comedy & shows, clubs). Broomfield JA på 20 mi (~15/kväll), NEJ på 10 mi. Moreno BORDERLINE (~3/kväll på 20 mi, ~7 på 35 mi; fre-sön högre). Brookings NEJ (~1/kväll på 75 mi, mest sport) -> noindex.
- /this-weekend: Glasgow, Broomfield (20 mi), Moreno (35 mi: 127 fre-sön-kvällar) JA; Brookings (26 på 75 mi) BORDERLINE.
- /food-drink/open-late: Glasgow JA, Broomfield JA, Moreno NEJ (OSM-täckning), Brookings NEJ; grannstäder (Riverside, Boulder) skulle lyfta.
- /food-drink/coffee: Glasgow JA, Broomfield JA, Brookings NEJ, Moreno NEJ (OSM-taggar för tunna).
- /food-drink/happy-hour: ingen stad utan registret + extraktion; OSM-taggen räcker bara i Denver.

## Förslag till ägarens beslut (inget byggs)
1. /tonight först i Glasgow och Broomfield; Moreno efter 35 mi-test; Brookings noindex.
2. Fråga Skiddle skriftligt (annonsfinansierad sajt) innan någon nyckel används.
3. Register för hand för Brookings/Moreno; "Add your event" för dessa två.
4. Läs villkor per ställe (särskilt de fem som blockerar AI-botar) innan de går in i registret.

OSÄKERHETER: RSS-flaggorna ej verifierade; bara startsidor; SeatGeek/Songkick/Dice obedömda; Skiddles Glasgow-täckning otestad; Ticketmaster-siffror är en ögonblicksbild 2026-10-28.
