"""Run a town's configured sports sources into sport_events, one source at a time, and log each outcome in sport_sources_health.

A source that must not be fetched (robots, a 403, a Crawl-delay above max_crawl_delay) is logged as `skipped: <reason>` and left alone;
one failing source never stops the others. Writes go through the caller's cursor (db.get_conn(), so the prod write guard applies).
"""
from __future__ import annotations

from sports import adapters, store
from sports.http import DEFAULT_MAX_CRAWL_DELAY, PoliteHttp, SourceSkipped
from sports.models import NormalizedEvent
from scrapers.user_agent import user_agent


def source_id(source: dict) -> str:
    return f"{source['adapter']}:{source.get('program', '*')}"


def run_source(cur, town_id: str, source: dict, *, http: PoliteHttp | None = None) -> str:
    """Returns 'ok', 'skipped' or 'error'."""
    sid = source_id(source)
    params = adapters.merged_params(source)
    params["_http"] = http or PoliteHttp(user_agent(town_id), mode=source.get("robots_mode", "standard"),
                                         max_crawl_delay=source.get("max_crawl_delay", DEFAULT_MAX_CRAWL_DELAY))
    try:
        if params.get("url"):
            params["_http"].preflight(params["url"])
        rows = adapters.get(source["adapter"])(params)
        events = [r for r in rows if isinstance(r, NormalizedEvent)]
        store.upsert_events(cur, town_id, events)
    except SourceSkipped as exc:
        store.record_health(cur, town_id, sid, error=f"skipped: {exc}")
        return "skipped"
    except Exception as exc:
        store.record_health(cur, town_id, sid, error=f"{type(exc).__name__}: {exc}")
        return "error"
    store.record_health(cur, town_id, sid, event_count=len(events))
    return "ok"


def run_town(cur, cfg: dict, *, http_factory=None) -> dict[str, str]:
    block = cfg.get("sports") or {}
    if not block.get("enabled"):
        return {}
    store.sync_programs(cur, cfg["town_id"], block)
    return {source_id(s): run_source(cur, cfg["town_id"], s, http=http_factory(s) if http_factory else None)
            for s in block.get("sources") or []}
