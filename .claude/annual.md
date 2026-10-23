# Saker som måste uppdateras varje år

Skapad 2026-10-24 (ägarens order). Lista över sidor/konfig vars innehåll har ett årtal eller en säsong inbyggd och därför blir fel om
ingen rör det. "När" = senast datum det ska vara gjort. "Senast gjort" fylls i vid varje uppdatering. state.md pekar hit.
Allt som visar fakta ur stadens/universitetets egna sidor ska läsas om mot källan, inte bara byta årtal.

| Sak | Var | Vad som ska uppdateras | När | Senast gjort |
|---|---|---|---|---|
| Thanksgiving-sidan | `site/src/config/thanksgiving.ts`, `site/src/lib/thanksgiving.ts` (THANKSGIVING_PAGE_YEAR), `site/astro.config.mjs` (noindex-datumet för /thanksgiving/) | Läs om varje stads helgregler, soptömning, landfill, bibliotek, kontor; byt årtal + sitemap-datum; kolla att sidan inte längre är noindex | 1 november | 2026-10-24 |
| Game day-guiden | `site/src/pages/game-day.astro` (SOURCES, CHECKED, text om parkering/tailgating/gates) | Läs gojacks.com tailgating + SDSU game day-sidan; ny säsongs regler; hemmamatcherna kommer ur sports_games automatiskt | augusti (före första hemmamatchen) | 2026-10-23 |
| Hobo Day | `site/src/lib/site-config.ts` (topEvents.patterns "Hobo Day"), konfig för brookings_sd; (Hobo Day-guide är inte byggd än, se backlog) | Datum härleds ur kalendern; kolla att eventet finns och mönstret fortfarande matchar; guiden (när den finns): paradväg, schema | september | 2026-10-24 |
| Sophämtning och återvinning (Brookings) | `site/src/pages/trash-recycling.astro`, `site/src/lib/trash-schedule.ts` (YARD_SEASON_2026), stadens "2026 Solid Waste Calendar and Guide" | Ny gårdsavfallssäsong (start/slut), avgifter (gäller 1 jan), vårens bulky pickup-datum, HHW-eventdatum, e-waste-avgift, landfill-tider; helgdagar räknas automatiskt | januari (avgifter) och mars (bulky/yard) | 2026-10-23 |
| Stadsfullmäktigeguiden (Brookings) | `site/src/pages/how-city-council-works.astro` | Ledamöter (kolla efter val), mötesdagar, länkar till årets mötes-PDF (2026/2027-kalendern), policy | januari och efter varje val | 2026-10-23 |
| Valsidor | `site/src/config/election.ts`, `site/src/pages/vote.astro`, `/election-results/`, `election-results/` (Worker, fetchUntil), CityStatus-raden | Ta bort/arkivera 2026-valet (noindex 30 dagar efter valet sker automatiskt), lägg in nästa val med källor per datum; Workerns fetchUntil och cron | senast 60 dagar före nästa val; städning inom 45 dagar efter valet | 2026-10-21 |
| Campusguiden | `site/src/pages/sdsu-campus-open-to-public.astro` (tider, priser, besöksparkering, CHECKED) | Läs om sdstate.edu-sidorna (museer, McCrory, Dairy Bar, parkering) | augusti (läsårsstart) | 2026-10-23 |
| Berikade facilities | `scripts/seed_brookings_places_enrichment.py` (CURATED), tabellen `places` (verified_date) | Läs om tider/priser/regler per anläggning; kör om skriptet (UPDATE, ägarens ja, backup först) | juli | 2026-10-23 |
| Moreno/Broomfield facilities, öppettider | `data/facilities/*.json`, `place_hours`, stalenessgränsen i lib/place-hours.ts | Verifiera öppettider (hours_needs_review) | juni | (se backlog) |
| Säsongs- och högtidsbilder (US) | `site/src/config/this-week-images.ts`, `holidays.ts` | Vår- och sommarpooler saknas helt: måste finnas före 1 mars 2027; nya högtidspooler för nivå 2 | 1 mars | pågår |
| Glasgow: juridiska sidor | `site/src/components/legal/gb/*` | Granskning av jurist före lansering och därefter årligen; Privacy/Cookies ska stämma med om GA4/AdSense slås på | före noindex tas bort; sedan 1 gång/år | ej granskad |
| Glasgow: ICO-avgift och UK GDPR-representant (art. 27) | state.md (blockerande före lansering) | Utred/registrera; förnya ICO-avgiften varje år när den väl finns | före noindex tas bort; förnyelse årligen | ej utrett |
| Cron-dispatcherns GitHub-token | Cloudflare Worker `viewmedia-cron-dispatcher` (secret GITHUB_TOKEN), state.md "Gällande beslut" | Skapa ny fine-grained token (Actions:write, bara detta repo) och `wrangler secret put` | utgår 2027-10-21; påminnelse senast 2027-10-07 | skapad 2026-10-21 |
| API-nycklar med utgång | Adzuna, Ticketmaster, Pexels, Met Office DataHub (när den finns), Companies House, Sportmonks | Kolla utgångs-/kvotvillkor | januari | - |
| Nyckelord i veckosammanfattningens teman | `site/src/lib/week-groups.ts` | Granska om tomma eller feltaggade grupper dyker upp (t.ex. nya typer av event) | oktober | 2026-10-24 |
| Copyright/år i sidfot och `Last updated`-texter | juridiska sidor (privacy, cookies, terms), about | "Last updated" ska stämma med verklig ändring | vid varje ändring, minst årligen i januari | - |
