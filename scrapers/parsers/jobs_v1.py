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

FAS 2: category/salary_min/salary_max saneras nu vid parse (se
_classify_category/_sanitize_salary) INNAN raden skrivs. Eftersom DEDUP är
append-only (ON CONFLICT DO NOTHING) rättar detta bara rader som skrapas
FRAMÅT -- redan lagrade rader med Adzunas råa kategori/nollor uppdateras
inte automatiskt av en vanlig körning. Se scripts/backfill_jobs_categories.py
för en engångskörning som sanerar befintliga rader med exakt samma logik.
"""
from __future__ import annotations

import json
import os
import re

import requests

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult

_API_BASE = "https://api.adzuna.com/v1/api/jobs"

# Adzunas svar innehåller redan en förkortad beskrivning (inte hela
# annonstexten -- redirect_url pekar dit), men trunkeras ändå hårt här så en
# ovanligt lång sammanfattning aldrig dominerar /jobs-tabellen.
_MAX_DESCRIPTION_CHARS = 500

# FAS 2: Adzunas eget category.label missklassificerar regelbundet (t.ex.
# lagerjobb hamnade under "Other/General Jobs" vid liveverifiering 2026-08).
# Nyckelordslistan nedan matchas mot titeln FÖRST -- den är smalare men
# träffsäkrare än Adzunas bredare maskinella bucket. Bara om INGET nyckelord
# träffar faller vi tillbaka på Adzunas egen etikett, och bara om den etiketten
# inte är en av de kända "säger ingenting"-buckets. Annars: ingen kategori
# alls (None) -- en tom cell är ärligare än en gissning, se husregel 4.
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Healthcare & Nursing": ("nurse", "rn", "lpn", "cna", "medical assistant",
                             "physician", "caregiver", "home health", "phlebotomist"),
    "Warehouse & Logistics": ("warehouse", "forklift", "picker", "packer", "logistics",
                              "shipping", "receiving", "distribution center", "loader"),
    "Retail": ("cashier", "retail sales", "store associate", "stocker", "sales associate"),
    "Food Service": ("cook", "server", "barista", "food service", "restaurant",
                      "dishwasher", "line cook", "kitchen"),
    "Customer Service": ("customer service", "call center", "customer support"),
    "Education & Childcare": ("teacher", "childcare", "daycare", "preschool",
                               "tutor", "instructional aide"),
    "Construction & Trades": ("electrician", "plumber", "hvac", "carpenter",
                              "construction", "welder", "roofer"),
    "Transportation & Driving": ("driver", "cdl", "delivery driver", "truck driver"),
    "Administrative & Office": ("administrative assistant", "office assistant",
                                "receptionist", "data entry", "clerk"),
    "Security": ("security guard", "security officer"),
    "Manufacturing & Production": ("assembler", "production worker", "machine operator",
                                    "manufacturing"),
}
_GENERIC_ADZUNA_LABELS = {"Other/General Jobs", "Unknown"}


def _classify_category(title: str, adzuna_label: str | None) -> str | None:
    # FAS 2-FIX: en tidigare `kw in lowered`-substrängmatchning missklassade
    # t.ex. "...Microvascular Reconstruction Fellowship" som Construction &
    # Trades, eftersom "construction" är en substräng av "reconstruction"
    # (upptäckt av scripts/backfill_jobs_categories.py --dry-run mot riktig
    # data innan den här backfillen kördes på riktigt). Ordgräns-regex i
    # stället, samma princip som ai_pipeline/town_guard.py:s blocklista.
    lowered = title.lower()
    for category, keywords in _CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if re.search(r"\b" + re.escape(kw) + r"\b", lowered):
                return category
    if adzuna_label and adzuna_label not in _GENERIC_ADZUNA_LABELS:
        return adzuna_label
    return None


# FAS 2: liveverifiering hittade salary_min=0-rader ("$0-$45,000" i praktiken
# "upp till $45,000", inte att jobbet betalar noll) och några rader där
# min/max-förhållandet var orimligt (annons-brus, inte en riktig spännvidd).
# Sanera hellre till en ärlig halv-siffra/"ej angiven" än att visa nonsens.
_MAX_SALARY_RATIO = 15

# Brookings P6-omverifiering (2026-08-23, se NEEDS-HUMAN-REVIEW.md): den
# ursprungliga saneringen fångar bara ett för BRETT intervall, inte ett
# orimligt värde när min=max (en platt uppskattning, kvot=1, aldrig
# BRETT). Live-data hade båda felen samtidigt: "General Manager" hos en
# Domino's-franchise, salary_min=salary_max=16 208 (nästan säkert en
# feltolkad timlön stämplad som årslön), och "Licensed Psychiatrist" hos
# Headway, salary_min=salary_max=494 811 -- IDENTISKT för tre olika
# jobbtitlar hos samma arbetsgivare, vilket pekar mot ett kategorisnitt
# Adzuna returnerar snarare än en riktig per-annons siffra. Ett absolut
# rimlighetsintervall fångar båda utan att röra en riktig, bred spännvidd.
# Gränserna är medvetet generösa (18 000, klart över federal minimilön
# ~15 080/år vid 40h/vecka, men fångar ändå den verkliga observerade raden
# på 16 208.31 -- en Domino's-franchise "General Manager"-annons vars
# salary_is_predicted=True Adzuna-uppskattning är orimlig för titeln,
# oavsett om siffran i sig teoretiskt kunde vara en riktig lön för någon
# annan roll; 350 000 är ett högt men inte orimligt tak för enstaka
# specialistroller) -- hellre missa en äkta högavlönad annons än visa fler
# konstruerade sex- eller femsiffriga tal.
_MIN_PLAUSIBLE_SALARY = 18_000
_MAX_PLAUSIBLE_SALARY = 350_000


def _sanitize_salary(salary_min, salary_max) -> tuple[float | None, float | None]:
    lo = salary_min or None
    hi = salary_max or None
    if lo and hi and hi / lo > _MAX_SALARY_RATIO:
        return None, None
    for value in (lo, hi):
        if value is not None and not (_MIN_PLAUSIBLE_SALARY <= value <= _MAX_PLAUSIBLE_SALARY):
            return None, None
    return lo, hi


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
                adzuna_label = (job.get("category") or {}).get("label")
                salary_min, salary_max = _sanitize_salary(job.get("salary_min"), job.get("salary_max"))

                rows.append({
                    "external_job_id": external_id,
                    "title": title,
                    "company": (job.get("company") or {}).get("display_name"),
                    "location": (job.get("location") or {}).get("display_name"),
                    "category": _classify_category(title, adzuna_label),
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                    "salary_is_predicted": job.get("salary_is_predicted") == "1",
                    "description": description,
                    "redirect_url": job.get("redirect_url"),
                    "posted_at": job.get("created"),
                    "source": "adzuna",
                    "raw_data": job,
                    "content_hash": content_hash("job", external_id, title),
                })
        return rows
