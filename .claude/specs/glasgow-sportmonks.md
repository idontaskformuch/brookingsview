# Glasgow sport: Sportmonks-adapter (FÖRBEREDD, EJ BYGGD)

Ägaren 2026-10-27. Byggs först när ägaren har lagt in `SPORTMONKS_API_KEY` (lokalt i .env och som Actions-secret i glasgow-scrape.yml). Spec: .claude/specs/glasgow-loop.md rad 44 ("Sports: Sportmonks free plan, Scottish Premiership: Celtic, Rangers"). Config finns redan: configs/glasgow.json data_sources.sports = { type: "sportmonks", enabled: false }.

## Före bygge (kontrolleras med nyckeln, inget antas)
- Free plan: vilka ligor ingår faktiskt (Scottish Premiership?), säsong, anropsgräns per timme/dygn, fördröjning på data, vilka `include`-fält som är tillåtna.
- Villkor: får fixturer/resultat visas publikt, krav på attribution/länk, förbud mot caching eller mot omdistribution. Ingen kringgång av begränsningar.
- Svarsform: hämta ett riktigt svar (fixtures between + participants + venue + scores) och spara som testfixtur innan parsern skrivs.

## Design (följer met_office_site_specific_v1)
- `scrapers/parsers/sportmonks_v1.py`, type `sportmonks`, registrerad i REGISTRY; nyckel ur `SPORTMONKS_API_KEY`, aldrig i loggar.
- Två anrop per körning: kommande fixturer (nästa 14 dagar) och senaste resultat (7 dagar). Cache/skonsamt: en körning per scrape-cykel (var 6:e timme).
- Skriver samma tabell som övriga lagmatcher (games, se regional_sports_v1) med fält: lag, hemma/borta, avspark (Europe/London), arena (Celtic Park, Ibrox m.fl.), status, resultat när spelad. Källa 'sportmonks', identity = fixture-id.
- Tomt svar, alla anrop felar, eller okänd form = fel (fail closed), aldrig halv data.
- Sajten: /sports/ för Glasgow (nu avstängd i nav), "Next match"-rad för Celtic och Rangers, kreditering "Data: Sportmonks" + länk enligt villkoren. Ingen AI-text. UK-spärren gäller (namn på spelare i rubriker tillåts bara som officiell fixturdata, inga domar/gripanden).
- Tester: fixturbaserade (som test_met_office_site_specific_v1), plus gate-test att `enabled:false` inte anropar API:et.

## Efter bygge
- configs/glasgow.json sports.enabled -> true, live-dry-run, första live-skrivning kräver ägarens ja (CLAUDE.md regel 7).
