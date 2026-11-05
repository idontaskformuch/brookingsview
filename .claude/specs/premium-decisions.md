# Premium-presentation: ägarens svar på Fas 0-besluten (2026-11-05, ordagrant i sak)

OK att starta Fas 1. Hänvisningar = punkter i premium-phase0-report.md §7.

1. **PageGuide -> AboutThisPage nederst.** Ja. Regeln från 2026-10-22 ersätts. Svaret först, förklaringar efter (eller inte alls).
2. **"Nu"-temperatur.** Prognosens värde för aktuell timme, diskret märkt (t.ex. "Forecast for 14:00"). Ingen ny observationskälla. Samma lösning US och Glasgow.
3. **Fas 5 URL.** Nya sidan bor på `/this-week/` (finns redan i nav). Gamla `/this-week/YYYY-wNN/` ska 301:as till `/this-week/` och bort ur sitemap. Arkiven har bara AI-ingress, inget unikt värde.
4. **"Updated".** Lagra `fetched_at` i alla städer. `issued` (Glasgow) får följa med i payloaden men `fetched_at` visas.
5. **AI-text.** Bort överallt (ingen AI-prosa på stadssajterna).
   - Mötesstories blir datarader: datum, tid, organ, plats, dagordningspunkter från källan, länk till agenda/protokoll och .ics.
   - Whats-on-introt och veckoingresserna raderas.
   - Ingen ersättningsprosa. Kort förklarande text bara där den hjälper läsaren förstå datan.
6. **Galleriet.** `pages/[design].astro`, noindex, ej i sitemap, bara byggt med `BUILD_DESIGN=1`.
7. **Sol-tider.** Med, beräknade ur lat/lon. Ingen "calculated"-etikett på kortet, bara en rad i AboutThisPage.
8. **NWS gridpoints.** Ja, lägg till anropet (känns som, byar, nederbördsmängd). Fälten valfria i payloaden, sidan tål att de saknas. Får landa som separat steg efter grundmodellen.
9. **Typsnitt.** Mät `tnum` i Bricolage Grotesque i Fas 1. Saknas det: föreslå sans med `tnum` för siffror. Mono ersätts som standard för data, inte bara justeras.
10. **Moreno tidsbuggen.** Ursprungsrapporten: **kvällsevents visar textdatum en dag fel** (tidszonsbugg), inte "23:30". Regressionsfixtur kring ett event kl. 19-23 lokal tid (= nästa dygn i UTC). Kontrollera datumrubrik, dag-gruppering och "today/tonight" på rätt lokalt datum.
11. **Fas 3, möten.**
    - Moreno har 0 kommande möten: kontrollera om scrapern är trasig innan BODIES byggs för Moreno.
    - Glasgow: huvudnämnder synliga, de 26 Area Partnerships under en utfällbar grupp.
    - Prioritera Broomfield (AdSense-målet).
    - Visa BODIES-förslag, dedup-fall och 3 exempelmöten per stad INNAN bygget.

**Defekter (Fas 1, med QA-kontroll + fixtur enligt regel 12):** Moreno /sports/ och Brookings /trash-recycling/ (horisontell scroll i 390 px); Moreno /home-sales/ "0 most recent".

**Prioritet genom alla faser:** Broomfield verifieras först och mest noggrant.
