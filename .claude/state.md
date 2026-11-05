# State (komprimerad 2026-11-05; all tidigare historik i .claude/state-archive.md, sök där på rubrikerna nedan)

## Nu: PREMIUM-PRESENTATION, Fas 1 (spec .claude/specs/premium-presentation.md, beslut .claude/specs/premium-decisions.md, regler .claude/standards.md)
- Fas 0 klar (rapport .claude/specs/premium-phase0-report.md). Fas 1: 1a standards.md, 1b tokens+typsnitt, 1c ui/-bibliotek+galleri KLARA. 1d Tonight på biblioteket PÅGÅR. Sedan 1e standard-layout-test (lib/ui/standard-layout.test.ts), 1f defekter (hscroll Moreno /sports/ + Brookings /trash-recycling/, Moreno /home-sales/ "0 most recent", alla med QA-kontroll+fixtur, regel 12).
- Ändrade filer 1b-1c: site/src/design/ui-tokens.css, site/src/components/ui/* (15), site/src/lib/ui/{ui-helpers,icons}.ts(+test), lib/ui-tokens.test.ts, pages/[design].astro (/_design/, bara BUILD_DESIGN=1, '/_design/' i astro.config noindexThinPageUrls), BaseLayout (--font-data = --font-ui, Plex Mono borta).
- BESLUT (ägaren, galleri-granskning 2026-11-05): hjälte clamp(3.5rem,16vw,5.5rem); kategorifärger max 6 PER SIDTYP (CATEGORY_SETS; Tonight: music,nightlife,family,sports,food,arts; civic bara Meetings/City hall); temperaturskala i stadens enhet (TEMP_BOUNDS_F konverteras, Glasgow °C, testat); Card/ikoner/FallbackTile behålls men ska vara lätta att byta (storlekar=tokens, ikoner bara via lib/ui/icons.ts); Chips >=3 träffar/chip, >=2 chips, inga siffror; AboutThisPage hopfälld men "Updated" synlig.
- Före/efter-skärmdumpar (390+1280, ljust+mörkt) för Fas 1 ska ligga committade i .claude/review/phase1/.
- Lokala commits ej pushade (pusha aldrig utan ja, regel 6): 392b561..88b2c7d + ev. nyare. Kontrollera `git log origin/main..HEAD` (klonen kan släpa, se memory).
## Kända buggar
- Hscroll 390 px Moreno /sports/ och Brookings /trash-recycling/; Moreno /home-sales/ "0 most recent"; Moreno kvällsevents visar datum en dag fel (tidszon, fixtur kring 19-23 lokal tid) -- Fas 1f resp. senare.
## Öppna spår (detaljer i state-archive.md)
- MEETINGS: nästa lilla uppgift ej byggd (förväntade rådsmöten via council-schedule.ts bara i Coming up; tidskonflikt -> "Time: see agenda"). Fas 3 i premium-spec ersätter delvis (AI-text bort, BODIES per stad).
- AI-prosa bort överallt (beslut 2026-11-05): mötesstories, whats-on-intro, veckoingresser; Fas 5 = ny /this-week/, gamla /this-week/YYYY-wNN/ 301.
- Tonight-kort: spec .claude/specs/tonight-cards.md, lib/tonight-cards.ts(+test 48), components/tonight/*; Tonight US-utrullning (Broomfield/Moreno/Brookings) gjord 2026-11-04.
- Högtidssidor (Thanksgiving/Veterans/Christmas): omkontroll ca 2026-11-18 och 2026-11-23 (supervised).
- Glasgow lanserad 2026-10-28/29 (noindex borta). AdSense-mål = Broomfield (audit klar, GSC-export saknas).
- Prioritet genom alla faser: Broomfield verifieras först och mest noggrant.
## Nästa steg
1d: bygg om Tonight på ui/* (behåll tc-* hooks/data-attribut för klient-JS och qa-probe), bygg alla fyra städer, spara före/efter i .claude/review/phase1/, stanna och lista vad ägaren ska granska.
