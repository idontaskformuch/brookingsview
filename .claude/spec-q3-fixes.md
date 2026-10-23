# Spec: åtgärder från Q3-rapporten (ägaren 2026-10-23)

Rapport: https://claude.ai/artifact/LCgc9jc7eVCqfnp6Jo99Xs . ETT COMMIT PER PUNKT, i ordning. Pusha inte utan ägarens ja.
Efteråt: kör Q3 (Sonnet) på berörda sidor och visa före/efter.

1. **Glasgow-varningar**: kompakt ruta (nivå, rubrik, giltighetstid, "Details") som länkar till /weather där hela texten finns,
   uppdelad i stycken. "Right now" ska visa varningen, inte "No weather alerts". KRAV FÖRE LANSERING.
2. **Tidsberoende innehåll i webbläsaren**: passerade event bort ur kommande-listor; öppet/stängt från place_hours i stadens
   tidszon; "last checked" i stadens tidszon; "right now" bara om data < 1 h, annars visa tidpunkten; mötessidor efter mötesdatum:
   "This meeting took place on ..." i stället för framtidsform.
3. **Ingresser** på facilities och liknande genereras deterministiskt ur samma data som tabellen. Inga löften som sidan inte uppfyller.
4. **Tomma/meningslösa sidor**: noindex och ut ur navigeringen tills de har innehåll (Brookings /traffic, Broomfield /events,
   Broomfield Workplace Watch). **Jobb**: slå ihop identiska annonser per företag+titel, gör tabellen läsbar på mobil.
5. **What's On**: filtrera "Club Level Seating" och liknande uppgraderingar, ingen konsert både i Marquee och Also on, visa årtal.
6. **Moreno /home-sales** enligt tidigare utredning (digester för framtida månader, stale data, arkivsortering, daggertförklaring).

## Status
- [ ] 1 Glasgow-varningar
- [ ] 2 tidsberoende innehåll
- [ ] 3 deterministiska ingresser
- [ ] 4 tomma sidor + jobb
- [ ] 5 What's On
- [ ] 6 Moreno home-sales
- [ ] Q3 före/efter (Sonnet) på berörda sidor
