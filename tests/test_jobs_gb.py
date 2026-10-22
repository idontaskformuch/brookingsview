"""Adzuna gb through scrapers/parsers/jobs_v1.py (Glasgow phase 3.6)."""
import json

from scrapers.base_parser import FetchResult
from scrapers.parsers.jobs_v1 import JobsParser, _classify_category, _sanitize_salary

GB_PAGE = {"results": [
    {"id": 5700001, "title": "HGV Class 1 Driver", "company": {"display_name": "Haulage Ltd"},
     "location": {"display_name": "Springboig, Glasgow"}, "category": {"label": "Logistics & Warehouse Jobs"},
     "salary_min": 38000, "salary_max": 42000, "salary_is_predicted": "0", "description": "x",
     "redirect_url": "https://www.adzuna.co.uk/jobs/land/ad/5700001", "created": "2026-10-20T09:00:00Z"},
    {"id": 5700002, "title": "Loss Adjuster", "company": {"display_name": "Aviva"},
     "location": {"display_name": "Whiteinch, Glasgow"}, "category": {"label": "Accounting & Finance Jobs"},
     "salary_min": 45719.49, "salary_max": 45719.49, "salary_is_predicted": "1", "description": "y",
     "redirect_url": "https://www.adzuna.co.uk/jobs/land/ad/5700002", "created": "2026-10-21T09:00:00Z"},
    {"id": 5700003, "title": "Bar Staff", "company": {"display_name": "Pub"},
     "location": {"display_name": "Glasgow City Centre, Glasgow"}, "category": {"label": "Hospitality & Catering Jobs"},
     "salary_min": 14, "salary_max": 14, "salary_is_predicted": "0", "description": "z",
     "redirect_url": "https://www.adzuna.co.uk/jobs/land/ad/5700003", "created": "2026-10-21T10:00:00Z"},
]}


def _parse(country):
    p = JobsParser({"town_id": "glasgow"}, {"country": country, "where": "Glasgow"})
    return p.parse(FetchResult(raw=json.dumps([GB_PAGE]).encode()))


def test_gb_titles_use_uk_keywords_only_for_gb():
    assert _classify_category("HGV Class 1 Driver", "Logistics & Warehouse Jobs", "gb") == "Transportation & Driving"
    assert _classify_category("Care Assistant", None, "us") is None
    assert _classify_category("Care Assistant", None, "gb") == "Healthcare & Nursing"
    assert _classify_category("Warehouse Operative", None, "gb") == "Warehouse & Logistics"  # shared list still applies


def test_gb_rows_keep_predicted_flag_and_drop_hourly_looking_salary():
    rows = {r["external_job_id"]: r for r in _parse("gb")}
    assert rows["5700001"]["category"] == "Transportation & Driving"
    assert (rows["5700001"]["salary_min"], rows["5700001"]["salary_max"]) == (38000, 42000)
    assert rows["5700002"]["salary_is_predicted"] is True and rows["5700001"]["salary_is_predicted"] is False
    assert rows["5700003"]["salary_min"] is None and rows["5700003"]["salary_max"] is None  # "14" is a rate, not a salary
    assert all(r["source"] == "adzuna" for r in rows.values())


def test_pound_salaries_pass_the_plausibility_range():
    assert _sanitize_salary(27000, 31000) == (27000, 31000)
