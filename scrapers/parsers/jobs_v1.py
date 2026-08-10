"""Lokala jobbannonser via Adzuna Job Search API -- en riktig, dokumenterad
API (utvecklarnyckel krävs, gratisnivå ~1000 anrop/månad, ~33/dag).

Verifierat live 2026-08-10 mot https://api.adzuna.com/v1/api/jobs/us/search/1
med app_id/app_key (från ADZUNA_APP_ID/ADZUNA_APP_KEY -- ENDAST env/secrets,
ALDRIG i configen, se configs/*.json:s "jobs"-block som bara anger "where").
Svarsformen (id, title, company.display_name, location.display_name,
category.label/tag, salary_min/max, salary_is_predicted, description,
redirect_url, created) bekräftad mot riktiga annonser för både
"Moreno Valley, CA" och "Brookings, SD".

KVOTSKYDD (viktigt, se runner.py): scrape.yml/moval-scrape.yml kör VARJE
aktiverad källa en gång/timme, oavsett källans egna refresh_minutes -- det
fältet var innan detta rent dokumenterande, aldrig avläst av koden. En
källa med Adzunas gratisnivå (~33 anrop/dag) hade tömts på några timmar om
den bara lagts till som vanligt. runner.py:run_source() fick därför en
riktig refresh_minutes-spärr (db.last_run_at) INNAN den här parsern skrevs
-- configens "refresh_minutes": 1440 (ett dygn) räcker nu på riktigt för
att garantera exakt ETT Adzuna-anrop per ort och dag, trots att workflown
själv triggas varje timme.

DEDUP: append-only (se migration 012) -- en jobbannons antas oföränderlig
källdata en gång skrapad, samma resonemang som möten/event, till skillnad
från regional_sports_games/traffic_incidents. Standard
ON CONFLICT (town_id, external_job_id) DO NOTHING.
"""
from __future__ import annotations

import json
import os

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

_API_BASE = "https://api.adzuna.com/v1/api/jobs"

# Adzunas svar innehåller redan en förkortad beskrivning (inte hela
# annonstexten -- redirect_url pekar dit), men trunkeras ändå hårt här så en
# ovanligt lång sammanfattning aldrig dominerar /jobs-tabellen.
_MAX_DESCRIPTION_CHARS = 500


class JobsParser(BaseParser):
    table = "jobs"
    platform = "adzuna"
    # UNIQUE-constrainten (se migration 012) är (town_id, external_job_id),
    # INTE standarden (town_id, content_hash) -- samma skäl som
    # school_alerts_v1.py/traffic_v1.py. update_columns lämnas odeklarerat
    # (DO NOTHING): en jobbannons antas oföränderlig källdata en gång
    # skrapad, se moduldocstring.
    conflict_columns = ("town_id", "external_job_id")

    def fetch(self) -> FetchResult:
        app_id = os.environ.get("ADZUNA_APP_ID")
        app_key = os.environ.get("ADZUNA_APP_KEY")
        if not app_id or not app_key:
            raise RuntimeError("ADZUNA_APP_ID/ADZUNA_APP_KEY saknas (sätt i .env eller GitHub Actions secrets)")

        country = self.source_cfg.get("country", "us")
        where = self.source_cfg["where"]
        results_per_page = int(self.source_cfg.get("results_per_page", 50))
        max_pages = int(self.source_cfg.get("max_pages", 1))

        pages = []
        for page in range(1, max_pages + 1):
            url = f"{_API_BASE}/{country}/search/{page}"
            params = {
                "app_id": app_id,
                "app_key": app_key,
                "results_per_page": results_per_page,
                "where": where,
                "content-type": "application/json",
            }
            r = requests.get(url, params=params, timeout=20)
            r.raise_for_status()
            data = r.json()
            pages.append(data)
            if len(data.get("results", [])) < results_per_page:
                break  # sista sidan -- inget mer att hämta

        self._pages = pages
        raw = json.dumps(pages, default=str).encode("utf-8")
        return FetchResult(raw=raw, content_type="application/json",
                           url=f"{_API_BASE}/{country}/search/1", http_code=200)

    def parse(self, fetched: FetchResult) -> list[dict]:
        pages = getattr(self, "_pages", None)
        if pages is None:
            pages = json.loads(fetched.raw.decode("utf-8"))

        rows = []
        for page in pages:
            for job in page.get("results", []):
                external_id = str(job.get("id"))
                title = job.get("title")
                if not external_id or not title:
                    continue

                description = (job.get("description") or "")[:_MAX_DESCRIPTION_CHARS]

                rows.append({
                    "external_job_id": external_id,
                    "title": title,
                    "company": (job.get("company") or {}).get("display_name"),
                    "location": (job.get("location") or {}).get("display_name"),
                    "category": (job.get("category") or {}).get("label"),
                    "salary_min": job.get("salary_min"),
                    "salary_max": job.get("salary_max"),
                    "salary_is_predicted": job.get("salary_is_predicted") == "1",
                    "description": description,
                    "redirect_url": job.get("redirect_url"),
                    "posted_at": job.get("created"),
                    "source": "adzuna",
                    "raw_data": job,
                    "content_hash": content_hash("job", external_id, title),
                })
        return rows
