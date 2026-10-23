# Spec: University digest (ägaren 2026-10-23)

Gäller /university/ och digest-sidorna (`university_digest`, slug `university-digest-<år>-w<NN>`, sidan /s/<slug>/). Brookings-only.

1. **Samma nya struktur som stadens veckosammanfattning** (ai_pipeline/weekly.py + site lib/week-groups.ts):
   - AI skriver BARA en kort ingress: 3-4 meningar, max ~80 ord, inga dagar/tider/datum/listor
     (återanvänd `intro_format_violations` + räknar-fallback).
   - Sidan visar temagrupper med deterministisk eventlista (rader "Fri 7pm · Titel · plats"),
     länkade till eventsidorna.
2. **/university/**: visa bara INNEVARANDE vecka, och bara ingressen + länken "See the full week".
   Ingen dubbel text mellan listan och detaljsidan.
3. **Äldre veckor**: inte i listan på /university/. En liten länk "Earlier weeks" till ett arkiv.
   De äldre digesterna är redan noindex utöver de 8 senaste (lib/this-week.ts recentWeekSlugs).
4. **Hero-bild**: Pexels / Quang Vuong (pool-bild `brookings_sd-university-2.png`) ser ut som ett annat
   universitet (gotisk, troligen University of Chicago). Kontrollera, och denylista om den visar en
   identifierbar annan plats.
5. **Regenerera innevarande vecka i live-DB** efter ändringen (regel 7: live-skrivning, ägaren har
   beordrat den i denna instruktion).

## Utredning 2026-10-23 (före bygge)
- Bilden = Pexels 27276232 (Quang Vuong), Pexels-alt: "historic university campus ... in Chicago".
  Visuellt: collegiate gothic, murgröna, orange takpannor = INTE SDSU. DENYLISTAS (scripts/category_image_denylist.json
  + borttagen ur site/src/config/category-images.ts).
- Obs, ej åtgärdat (ägaren avgör): university-3 (Elijiah Pearson, 36725428) är en monumental klassisk
  kalkstensbyggnad som liknar ett statligt domstolshus, inte SDSU.
