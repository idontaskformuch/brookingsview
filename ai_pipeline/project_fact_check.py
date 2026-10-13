"""Fact guardrail for `projects.description` -- wires the existing generic
fact-check (ai_pipeline/guardrails.py:validate()) into the one place that
writes that field (scripts/seed_projects.py), fail-closed: a description
whose numbers/names don't verify against this project's own real source
text is never written -- any existing row stays exactly as it was.

Source text is built fresh each run, not stored anywhere -- it has to be
whatever a human curating data/projects/<town_id>.json would also be
reading, keyed off the SAME match fields project_registry.py and
project_updates_legistar.py already use to thread real updates onto a
project, never a separate/parallel lookup:

  - eSCRIBE/AgendaLink towns (case_numbers): every meeting agenda item and
    action-summary item, any meeting already scraped for this town, whose
    text contains one of the project's case numbers -- same substring
    rule as project_registry.match_project() (project_registry.
    text_matches_case_numbers(), including its hyphen-line-wrap fix).
  - Legistar towns (legistar_matter_ids): the live Matter object from
    webapi.legistar.com for each id -- the same real endpoint
    ai_pipeline/project_updates_legistar.fetch_matter() already reads,
    called fresh, never cached.

A project with NEITHER field, or where neither field turns up any source
text at all (case number never seen in a scraped meeting; a matter id
that 404s), fails closed -- "nothing to verify against" is reported as a
violation, never silently treated as a pass.
"""
from __future__ import annotations

import json

from ai_pipeline import guardrails
from ai_pipeline.project_registry import text_matches_case_numbers


def _source_text_case_numbers(conn, town_id: str, case_numbers: list[str]) -> str:
    if not case_numbers:
        return ""
    with conn.cursor() as cur:
        cur.execute("SELECT raw_data FROM meetings WHERE town_id = %s", (town_id,))
        rows = cur.fetchall()
    texts: list[str] = []
    for (raw,) in rows:
        if not raw:
            continue
        for item in raw.get("agenda_items") or []:
            text = f"{item.get('title', '')} {item.get('description', '')}"
            if text_matches_case_numbers(text, case_numbers):
                texts.append(text)
        for item in raw.get("action_summary_items") or []:
            if text_matches_case_numbers(item.get("title", ""), case_numbers):
                texts.append(json.dumps(item))
    return "\n".join(texts)


def _source_text_legistar(cfg: dict, matter_ids: list[int]) -> str:
    if not matter_ids:
        return ""
    from ai_pipeline.project_updates_legistar import fetch_matter  # live network call -- only imported if actually needed

    client = cfg["data_sources"]["city_meetings"]["client_id"]
    texts = []
    for matter_id in matter_ids:
        matter = fetch_matter(client, matter_id)
        if matter:
            texts.append(json.dumps(matter))
    return "\n".join(texts)


def source_text_for_project(conn, town_id: str, project: dict, cfg: dict) -> str:
    """project: a dict with the same shape as a data/projects/<town>.json
    entry -- needs case_numbers and/or legistar_matter_ids."""
    parts = [
        _source_text_case_numbers(conn, town_id, project.get("case_numbers") or []),
        _source_text_legistar(cfg, project.get("legistar_matter_ids") or []),
    ]
    return "\n".join(p for p in parts if p)


def check_project_description(conn, town_id: str, project: dict, cfg: dict) -> guardrails.GuardrailResult:
    source_text = source_text_for_project(conn, town_id, project, cfg)
    if not source_text.strip():
        return guardrails.GuardrailResult(
            passed=False,
            violations=[
                "no source text found for this project's case_numbers/legistar_matter_ids "
                "-- cannot verify, treated as a fail, not a pass"
            ],
        )
    return guardrails.validate(project["description"], source_text, cfg)
