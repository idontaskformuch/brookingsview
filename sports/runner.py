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


def read_source(town_id: str, source: dict, *, http: PoliteHttp | None = None, log=None):
    """The network half of a run, shared with --dry-run: robots preflight, then the adapter's rows (a list, or Fetched with `.unread`).
    `log(text)` receives one line per API call from adapters that report them (never a URL or header)."""
    params = adapters.merged_params(source)
    if log:
        params["_log"] = log
    params["_http"] = http or PoliteHttp(user_agent(town_id), mode=source.get("robots_mode", "standard"),
                                         max_crawl_delay=source.get("max_crawl_delay", DEFAULT_MAX_CRAWL_DELAY))
    if params.get("url"):
        params["_http"].preflight(params["url"])
    return adapters.get(source["adapter"])(params)


def run_source(cur, town_id: str, source: dict, *, http: PoliteHttp | None = None) -> str:
    """Returns 'ok', 'skipped' or 'error'."""
    sid = source_id(source)
    try:
        rows = read_source(town_id, source, http=http)
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


def _describe(e: NormalizedEvent) -> str:
    when = e.start_at.strftime("%a %Y-%m-%d") + (" (time TBA)" if e.time_tba else e.start_at.strftime(" %H:%M %Z"))
    score = f" {e.score_home}-{e.score_away}" if e.score_home is not None and e.score_away is not None else ""
    return f"{when}  {e.home_name} v {e.away_name}{score}  [{e.status}]" + (f"  @ {e.venue}" if e.venue else "")


def dry_run_town(cfg: dict, *, http_factory=None, out=print) -> dict[str, str]:
    """Calls each configured source (the API/pages, with the same robots and delay rules) and prints what a real run would write. Never opens a
    database connection, never syncs programs, never records health, never withdraws: nothing is written anywhere. Works while sports.enabled is false."""
    outcome: dict[str, str] = {}
    for source in (cfg.get("sports") or {}).get("sources") or []:
        sid = source_id(source)
        try:
            rows = read_source(cfg["town_id"], source, http=http_factory(source) if http_factory else None,
                               log=lambda line, sid=sid: out(f"[dry-run {sid}] {line}"))
        except SourceSkipped as exc:
            out(f"[dry-run {sid}] skipped: {exc}")
            outcome[sid] = "skipped"
            continue
        except Exception as exc:
            out(f"[dry-run {sid}] error: {type(exc).__name__}: {exc}")
            outcome[sid] = "error"
            continue
        events = [r for r in rows if isinstance(r, NormalizedEvent)]
        out(f"[dry-run {sid}] WOULD WRITE {len(events)} sport_events row(s) (upsert on town_id, source, source_uid); nothing was written")
        for e in sorted(events, key=lambda x: x.start_at):
            out(f"    {_describe(e)}   uid={e.source_uid}")
        for u in getattr(rows, "unread", []):
            out(f"    NOT READ: {u.get('slug') or u['sport']}: {u['reason']} (a real run would leave its rows as they are)")
        problems = [(e.source_uid, p) for e in events for p in e.problems()]
        for uid, p in problems:
            out(f"    PROBLEM: {uid}: {p}")
        outcome[sid] = "ok"
    return outcome


def main(argv: list[str] | None = None) -> int:
    """python -m sports.runner --town brookings_sd [--dry-run] [--even-if-disabled] [--prod]   (--prod is read by db.db, not here)."""
    import argparse
    import json
    import os
    from pathlib import Path

    from db.db import declare_action, get_conn

    ap = argparse.ArgumentParser(prog="sports.runner")
    ap.add_argument("--town", required=True)
    ap.add_argument("--dry-run", action="store_true", help="call the source(s) and print what would be written; no database connection, nothing written")
    ap.add_argument("--even-if-disabled", action="store_true", help="run a town whose sports.enabled is still false (one manual run)")
    args = ap.parse_args(argv)
    if args.even_if_disabled and (os.environ.get("GITHUB_ACTIONS") or os.environ.get("GITHUB_RUN_ID") or os.environ.get("CI")):
        raise SystemExit("--even-if-disabled är en lokal engångskörning och vägras i CI/workflows; slå på sports.enabled i configen i stället.")
    cfg = json.loads((Path(__file__).resolve().parent.parent / "configs" / f"{args.town}.json").read_text(encoding="utf-8"))
    if args.even_if_disabled:
        cfg = {**cfg, "sports": {**(cfg.get("sports") or {}), "enabled": True}}
    if args.dry_run:
        outcome = dry_run_town(cfg)
        print(json.dumps(outcome, indent=1))
        return 0 if outcome and all(v == "ok" for v in outcome.values()) else 1
    declare_action("sports_runner")
    with get_conn() as conn, conn.cursor() as cur:
        outcome = run_town(cur, cfg)
    print(json.dumps(outcome, indent=1))
    return 0 if outcome and all(v == "ok" for v in outcome.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
