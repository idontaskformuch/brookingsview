# Kö 6 -- meetings-dubbletter: plan (2026-10-21, INGET skrivet mot live-DB, ingen kod ändrad)

## Fakta (read-only, 2026-10-21)
- Orsak: scrape_runs 11502 (city_meetings, Moreno, 2026-10-01 22:05:02Z), 44 s efter e8776ca (tidszonsfix
  ändrade content_hash). 13 nya rader (13779-13791), alla dubletter av äldre rader. Ingen script-rad.
- Index: bara UNIQUE (town_id, content_hash). Inget index på guid -- "unikt index från Phase B" var FEL premiss.
- dedup_check_columns (701e30e, 14 okt) tar bara byte-identisk raw_data; 14586 (15 okt) och 14970 (20 okt)
  slank igenom (raw_data skilde -> ny hash -> ny rad).
- Redan hanterat 2026-10-14 (superseded_by_slug + duplicate-story-redirects.json, 11 poster):
  9 grupper GAMLA story -> NYA (12940,11940,10839,11040,11855,11412,8298,11413,10840), 2 grupper NYA -> GAMLA
  (13789->12443, 13783->12442). Alla 11 är live-301 och utanför sitemap (astro.config.mjs:718).
- OHANTERAT (två live dubbelsidor): 6918217e (11040/13780/14970; story 3441 sup->13780-storyn, 4008 live) och
  c47d15ac (14192/14586; stories 3944 + 3974, båda live, ingen sup).
- Brookings (EventGuid/EventId) och Broomfield (id): 0 dubbletter. Samma ON CONFLICT-mönster (hash på rå
  källsträng, stabilt) men oexponerat; Moreno-fixen bör gälla alla tre via generell identity-nyckel.

## Steg (ordning: 1 push -> 2 SQL-skript -> 3 index)
1. Kodfix: BaseParser.identity_key (eSCRIBE: raw_data->>'ID'; Legistar EventId; AgendaLink id). upsert_records:
   SELECT min(id) för (town_id, nyckel); finns -> UPDATE den raden (merge raw_data, meeting_date, urls),
   annars INSERT. (ON CONFLICT på uttrycksindex går inte före steg 3 -> förslag = SELECT+UPDATE.)
   RISK: UPDATE av content_hash kolliderar mot dubblettens hash (UNIQUE) -> sätt bara om ingen annan rad har
   den hashen (annars lämna). Tester: ny hash + befintligt ID -> UPDATE ej INSERT; kolliderande hash; 2 dubbletter
   -> äldsta uppdateras.
2. Städning (skript med före/efter-kontroll, ägarens ja först). Per grupp behåll äldsta meeting. Nyare data i
   dubbletten flyttas (merge raw_data, nyaste vinner per nyckel). Story: dubblettens story -> superseded_by_slug =
   äldsta radens story-slug. Problem: stories.meeting_id FK + unikt index (035) hindrar radering av dubbletten
   och publish.py:existing_meeting_ids ignorerar NULL meeting_id -> sätt superseded storys meeting_id NULL, SEN
   radera dubblett-meetingen. Kräver beslut: de 9 redan-omvända grupperna (gammal->ny) -- flippa riktning
   (skriv om sup + JSON; gammal slug kan vara indexerad) eller behåll riktningen och behåll NYA meetingen?
3. UNIQUE INDEX ON meetings (town_id, (raw_data->>'ID')) -- bara Moreno/eSCRIBE (andra städer har andra nycklar;
   partial WHERE raw_data ? 'ID' om delad tabell).
4. Efter 2: generate_duplicate_story_redirects.py, bygg, sitemap/noindex-kontroll.
