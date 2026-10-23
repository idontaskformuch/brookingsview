# Spec: åtgärder från Q3-rapporten (ägaren 2026-10-23)

Rapport: https://claude.ai/artifact/LCgc9jc7eVCqfnp6Jo99Xs . ETT COMMIT PER PUNKT, i ordning. Pusha inte utan ägarens ja.
Efteråt: kör Q3 (Sonnet) på berörda sidor och visa före/efter.

1. **Glasgow-varningar**: kompakt ruta (nivå, rubrik, giltighetstid, "Details") som länkar till /weather där hela texten finns,
   uppdelad i stycken. "Right now" ska visa varningen, inte "No weather alerts". KRAV FÖRE LANSERING.
2. **Tidsberoende innehåll i webbläsaren**: passerade event bort ur kommande-listor; öppet/stängt från place_hours i stadens
   tidszon; "last checked" i stadens tidszon; "right now" bara om data < 1 h, annars visa tidpunkten; mötessidor efter mötesdatum:
   "This meeting took place on ..." i stället för framtidsform.
3. **Ingresser** på facilities och liknande genereras deterministiskt ur samma data som tabellen. Inga löften som sidan inte uppfyller.
   **Tillägg (ägaren, andra sändningen):** City Hall: kontrollera tiderna mot stadens egen sida och rätta så att `place_hours` och `hours_text` stämmer överens.
   (Den andra sändningen av listan var avkortad efter punkt 5; punkt 5-6 gäller som i den första.)
4. **Tomma/meningslösa sidor**: noindex och ut ur navigeringen tills de har innehåll (Brookings /traffic, Broomfield /events,
   Broomfield Workplace Watch). **Jobb**: slå ihop identiska annonser per företag+titel, gör tabellen läsbar på mobil.
5. **What's On**: filtrera "Club Level Seating" och liknande uppgraderingar, ingen konsert både i Marquee och Also on, visa årtal.
6. **Moreno /home-sales** enligt tidigare utredning (digester för framtida månader, stale data, arkivsortering, daggertförklaring).

## Status
- [x] 1 Glasgow-varningar (kompakt ruta + Details -> /weather/#weather-warnings med full text i stycken; Right now fylls ur API:et, aldrig statiskt "No weather alerts"; /today/ visar bara Right now-raden; verifierat i Chromium med riktig Storm Boelo-data, med och utan varningar)
- [x] 2 tidsberoende innehåll (data-hide-ended på kommande-listor; Right now -> "As of <tid>" efter 1 h; möte efter dagen -> "This meeting took place on ..." i webbläsaren; veckodagsetikett i stadens tidszon (bugg: place-hours.ts); verifierat i Chromium med fejkad klocka)
- [x] 3 deterministiska ingresser (facility-lede: timmar ur samma place_hours-rader som tabellen; City Hall place_hours + hours_structured rättade mot stadens sida (live-DB, beordrat); scripts/check_hours_consistency.py + sync_place_hours_from_text.py; /weather/ säger "No active weather alerts"). KVAR hos ägaren: public-library (Mon-Thu 8pm enligt bibliotekets sida; place_hours/hours_structured säger 9pm) + Glasgows 9 platser utan hours_structured.
- [x] 4 tomma sidor + jobb (SiteConfig.quietSections: Brookings traffic, Broomfield events + workplace = noindex i sidan, ur sitemap (astro.config QUIET_PAGES + test), ur nav/footer; jobb: dedupeJobs per företag+titel (100 -> 67 rader, 18 med "N more identical listings"), korttabell på mobil, filterraden bryter rad -- scrollWidth 390/390; lyft genom att ta bort id:t ur quietSections och lägga tillbaka sektionen i nav)
- [x] 5 What's On (Club Level Seating/VIP/Parking-uppgraderingar filtreras, ingen post både i Marquee och Also on (alla datum i en Marquee-serie lämnar Also on), år på datum utanför innevarande år, "2 shows on Tue, Oct 27")
- [x] 6 Moreno home-sales (väntande månader (data_pending) listas aldrig; hubben visar de 2 senaste riktiga digesterna; arkivet nyast först efter månaden de täcker; †-förklaringen ovanför tabellen; "the county has not published newer records" när senaste försäljningen är > 4 mån gammal). EJ löst: själva datan stannar 2025-10-30 -- kräver ny assessor-rapport (ägaren).
- [ ] Q3 före/efter (Sonnet) på berörda sidor
