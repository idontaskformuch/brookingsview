"""READ-ONLY report: how well does each text type pass its checks, per model (owner 2026-10-23, .claude/spec-model-choice.md).

From api_usage (one row per API attempt, `attempt` 1,2,.. and `outcome` set by api_usage.finalize_generation):
    generations      attempts numbered 1
    first-try pass   attempt-1 rows whose generation published (outcome published / dry_run) on that very attempt
    retries          rows with attempt > 1
    fallbacks        generations that ended on a template (outcome template_fallback)
The check that decides pass/fail is the generator's own (guardrails.validate + pre_publish_check); this script only counts.

It REPORTS: a type where the newest model's first-try pass rate is clearly below the previous model's (default: 15 points, at
least 10 generations each) is flagged. It never changes a model.

    python -m scripts.model_quality_report [--days 30] [--town brookings_sd]
"""
from __future__ import annotations

import argparse

from db.db import get_conn

SQL = """
SELECT generator, COALESCE(model, '?') AS model,
       COUNT(*) FILTER (WHERE attempt = 1) AS generations,
       COUNT(*) FILTER (WHERE attempt = 1 AND outcome IN ('published', 'dry_run')) AS first_try_ok,
       COUNT(*) FILTER (WHERE attempt > 1) AS retries,
       COUNT(*) FILTER (WHERE outcome = 'template_fallback') AS fallbacks,
       COALESCE(SUM(cost_usd), 0) AS cost
  FROM api_usage
 WHERE provider = 'anthropic' AND created_at >= now() - make_interval(days => %(days)s)
   AND (%(town)s::text IS NULL OR town_id = %(town)s)
 GROUP BY generator, model
 ORDER BY generator, model
"""

CLEARLY_WORSE_POINTS = 15.0
MIN_GENERATIONS = 10


def pct(n: int, d: int) -> float:
    return 100.0 * n / d if d else 0.0


def flag_worse(rows: list[tuple]) -> list[str]:
    """Types where one model's first-try rate is >= CLEARLY_WORSE_POINTS below another model's (both with enough data)."""
    by_gen: dict[str, list[tuple]] = {}
    for generator, model, gens, ok, *_ in rows:
        if gens >= MIN_GENERATIONS:
            by_gen.setdefault(generator, []).append((model, pct(ok, gens), gens))
    out = []
    for generator, models in by_gen.items():
        if len(models) < 2:
            continue
        best = max(models, key=lambda m: m[1])
        for model, rate, gens in models:
            if best[1] - rate >= CLEARLY_WORSE_POINTS and model != best[0]:
                out.append(f"{generator}: {model} passes first try {rate:.0f}% ({gens} runs) vs {best[0]} {best[1]:.0f}% -- review, do not switch automatically")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--town", default=None)
    args = ap.parse_args()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(SQL, {"days": args.days, "town": args.town})
        rows = cur.fetchall()
    print(f"api_usage, last {args.days} days" + (f", {args.town}" if args.town else "") + "\n")
    print(f"{'generator':<34}{'model':<30}{'runs':>6}{'1st-try':>9}{'retries':>9}{'fallback':>10}{'USD':>9}")
    for generator, model, gens, ok, retries, fallbacks, cost in rows:
        print(f"{generator:<34}{model:<30}{gens:>6}{pct(ok, gens):>8.0f}%{retries:>9}{fallbacks:>10}{float(cost):>9.2f}")
    flags = flag_worse(rows)
    print("\n" + ("\n".join(["FLAGGED (report only):", *flags]) if flags else "No type is clearly worse on its newest model (or too little data to say)."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
