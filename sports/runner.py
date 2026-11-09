"""Run a town's configured sports sources into sport_events, one source at a time, and log each outcome in sport_sources_health.

A source that must not be fetched (robots, a 403, a Crawl-delay above max_crawl_delay) is logged as `skipped: <reason>` and left alone;
one failing source never stops the others. Writes go through the caller's cursor (db.get_conn(), so the prod write guard applies).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sports import adapters, store, withdraw
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
        programs = [source["program"]] if source.get("program") else sorted({e.program_id for e in events if e.program_id})
        known = withdraw.load_known(cur, town_id, source["adapter"], programs)  # before the upsert: "new to the table" is judged against it
        store.upsert_events(cur, town_id, events)
        unread = list(getattr(rows, "unread", []))
        decision = withdraw.plan(known, events, datetime.now(timezone.utc), {(u["program"], u["sport"], u["gender"]) for u in unread})
        decision.warnings += [f"{u.get('slug') or u['sport']}: not read ({u['reason'][:120]}); its rows were left as they were" for u in unread]
        withdraw.apply(cur, decision)
    except SourceSkipped as exc:
        store.record_health(cur, town_id, sid, error=f"skipped: {exc}")
        return "skipped"
    except Exception as exc:
        store.record_health(cur, town_id, sid, error=f"{type(exc).__name__}: {exc}")
        return "error"
    if decision.withdraw:
        print(f"    [sports:{sid}] withdrew {len(decision.withdraw)} upcoming game(s) the source no longer lists")
    for w in decision.warnings:
        print(f"    [sports:{sid}] warning: {w}")
    store.record_health(cur, town_id, sid, event_count=len(events), warning="warning: " + "; ".join(decision.warnings) if decision.warnings else None)
    return "ok"


def run_town(cur, cfg: dict, *, http_factory=None) -> dict[str, str]:
    block = cfg.get("sports") or {}
    if not block.get("enabled"):
        return {}
    store.sync_programs(cur, cfg["town_id"], block)
    return {source_id(s): run_source(cur, cfg["town_id"], s, http=http_factory(s) if http_factory else None)
            for s in block.get("sources") or []}


def main(argv: list[str] | None = None) -> int:
    """python -m sports.runner --town brookings_sd [--even-if-disabled] [--prod]   (--prod is read by db.db, not here)."""
    import argparse
    import json
    import os
    from pathlib import Path

    from db.db import declare_action, get_conn

    ap = argparse.ArgumentParser(prog="sports.runner")
    ap.add_argument("--town", required=True)
    ap.add_argument("--even-if-disabled", action="store_true", help="run a town whose sports.enabled is still false (one manual run)")
    args = ap.parse_args(argv)
    if args.even_if_disabled and (os.environ.get("GITHUB_ACTIONS") or os.environ.get("GITHUB_RUN_ID") or os.environ.get("CI")):
        raise SystemExit("--even-if-disabled är en lokal engångskörning och vägras i CI/workflows; slå på sports.enabled i configen i stället.")
    cfg = json.loads((Path(__file__).resolve().parent.parent / "configs" / f"{args.town}.json").read_text(encoding="utf-8"))
    if args.even_if_disabled:
        cfg = {**cfg, "sports": {**(cfg.get("sports") or {}), "enabled": True}}
    declare_action("sports_runner")
    with get_conn() as conn, conn.cursor() as cur:
        outcome = run_town(cur, cfg)
    print(json.dumps(outcome, indent=1))
    return 0 if outcome and all(v == "ok" for v in outcome.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
