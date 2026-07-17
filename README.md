# Brookings View

En varm, positiv, config-driven lokalnyhetssajt för Brookings, SD — byggd för att
besvara *"Vad händer i Brookings?"* och skala till 10+ orter där varje ny ort är en
config-fil, inte kodändring. Se `PLAN.md` för den fullständiga åtta-stadiers byggplanen.

**Aldrig:** jail-/arrest-/mugshot-/obituary-innehåll eller något anklagande om
namngivna privatpersoner. Vi beskriver händelser, lag, platser och trender.

## Arkitektur
```
Python-scrapers (GitHub Actions cron)
        │  fetch → snapshot → parse → dedup-upsert
        ▼
   Neon Postgres  ──►  AI-formatering (batch, guardrail-validerad)  ──►  stories
        │                                                                   │
        └───────────────► Cloudflare Pages deploy hook ◄────────────────────┘
                                    │
                          Astro (statiskt, config-drivet) → brookingsview.com
```

## Vad som redan är byggt
- `db/schema.sql` — fullt Postgres-schema (proveniens, snapshots, scrape_runs, dedup).
- `db/db.py` — anslutning, snapshot-lagring, dedup-upsert, körningslogg, alerting-räknare.
- `scrapers/base_parser.py` — parser-kontraktet (så nästa ort återanvänder parsers).
- `scrapers/runner.py` — config-driven orkestrering + händelsestyrt larm.
- **Riktiga parsers** (dokumenterade API:er): `noaa`, `nws_alerts`, `legistar_v1`, `usda`.
- **Dokumenterade stubbar** (väntar på Stage 0): `smartgov_v1`, `civicengage_pdf_v1`,
  `gojacks_v1`, `sd511`, `county_alerts`, `events`.
- `ai_pipeline/guardrails.py` — extraktiv validering mot hallucination + förbjudet innehåll.
- `ai_pipeline/format_prompt.py` — varm/faktastrikt formatering, mall-fallback, budgettak.
- `.github/workflows/scrape.yml` — schemalagd körning + deploy-hook-trigger.

## Snabbstart
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # fyll i DATABASE_URL m.m.
psql "$DATABASE_URL" -f db/schema.sql
python -m scrapers.runner --config configs/brookings_sd.json --only weather
```
`--only weather` kör bara den nyckelfria NOAA-källan — bra första rök-test.

## Stage 0 — verifiera INNAN parsers färdigställs
Aktiverade källor beror på riktiga endpoints. Status (2026-07-16), detaljer i
`configs/brookings_sd.json` → `_verify_before_launch`:
- [x] Legistar `client_id` = `cityofbrookings` — `webapi.legistar.com/v1/cityofbrookings/events` svarar 200
- [x] SDSU events-kalender = `sdstate.edu/event-calendar` — ingen iCal/RSS, kräver HTML-scrape
- [x] NWS zone/county-kod för Brookings County = `SDC011` (bekräftad, gissningen stämde)
- [~] SD DOT 511: sajt bekräftad (`sd511.org`), men ingen publik data-API hittad — behöver kontakt/reverse-engineering
- [~] SmartGov: portalen är publikt läsbar, men inga licens-/permitrapporter publicerade där just nu — behöver kontakt med staden
- [x] Brookings School District styrelseagenda = `brookingspublic.ic-board.com` (ic-BOARD) — blockar enkla requests (403), kräver headless browser
- [ ] USDA NASS API-nyckel (gratis, instant via mejlformulär på `quickstats.nass.usda.gov/api` — du behöver fylla i det själv)

## Att lägga till en ny ort
1. `configs/<town>.json` (kopiera Brookings, byt identitet + källor).
2. Kör igen mot samma parsers. Legistar-orter återanvänder `legistar_v1` rakt av.
3. Bygg bara ort-specifika, jail-fria källor. Begränsande faktor = unika plattformar,
   inte antal orter.

## Guardrails (permanent)
AI-lagret får aldrig hitta på namn, siffror eller citat. `guardrails.validate()`
avvisar output med fakta som inte finns i källan och allt som rör `never_publish`.
Faller en text → striktare omförsök → annars ren mall. Hellre torrt men sant.
