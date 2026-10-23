# Spec: QA Q3 -- veckovis AI-granskning (ägaren 2026-10-23)

Flyttas fram FÖRE Q2 (DB-invarianter). Bygger på qa/ (se .claude/spec-qa-automation.md, qa/README.md).
CLAUDE.md regel 12 gäller: QA-trafik räknas aldrig som besökare, ändra inte samtyckes-/analysblockeringen i qa/web/run.mjs.

## Checklista per sida (från ägarens egna fynd)
1. Läckt kod/tecken i synlig text (")}", "{{", "${", "undefined" ...) -- även i header/nav/footer, inte bara <main>
2. Fel eller passerade datum (event/varning som redan gått, "Today" på fel dag)
3. Dubbelt innehåll (samma text i lista och detaljsida)
4. Gammalt innehåll som tar för stor plats (äldre veckor/arkiv i huvudlistor)
5. Fel bild: fel stad, fel säsong, identifierbar annan plats (annat universitet, skyltar, landmärken)
6. Tomma rubriker (rubrik utan innehåll)
7. Oklara förkortningar ("VB vs USD")
8. Täta textblock (väggar av text utan struktur)
9. Problem i ljust/mörkt läge (kontrast, osynlig text, fel bakgrund)
10. "Hjälper sidan en invånare?" (redaktionell grundregel i CLAUDE.md: data -> vad betyder det -> vad kan läsaren göra)

## Underlag
En skärmbild per SIDTYP per STAD, mobil, båda lägen (ljust + mörkt).

## Resultat
Rapport (HTML/markdown) med skärmbild + fynd + föreslagen orsak per fynd. Kör en första gång MANUELLT och visa rapporten.
Veckovis automatisering först efter att ägaren sett första rapporten.

## Status
- [ ] sidtyper per stad inventerade
- [ ] skärmbilder (mobil, ljust/mörkt)
- [ ] AI-granskning mot checklistan
- [ ] rapport visad för ägaren

## Tillägg 2026-10-23 (ägaren)
- **Regel `web.duplicate-content`**: om en sida till största delen (> 70 %) består av text som redan finns på en sida som LÄNKAR TILL den,
  flagga BÅDA sidorna. Körs över alla sidor (Pass A i qa/web/run.mjs, alla sitemap-URL:er; kräver att run.mjs alltid samlar interna länkar).
- **AI-granskning av sidpar**: lista + detaljsida bredvid varandra. Frågor: tillför detaljsidan något som listan saknar? Skicka med dagens
  datum: tar gammalt innehåll för stor plats?
- **born_from** för båda: "University digest-fyndet 2026-10-23" (/university/ visade digestens långa text som kort och detaljsidan samma text igen).
  Regressionsfixtur: tests/fixtures/qa_duplicate_university_2026-10-23.json (verklig text från live före ändringen).
