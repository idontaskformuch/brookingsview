"""SDSU Jackrabbits season-to-date summary -- ONE standing story per sport
(slug "jackrabbits-season-summary-<sport>"), updated in place as the season
progresses. See NEEDS-HUMAN-REVIEW.md "University Coverage Rebuild", A.1:
/jackrabbits was a raw schedule/results table with no editorial layer at
all -- this is that layer, rendered above each sport's table in
jackrabbits.astro.

DIFFERENT SHAPE FROM sports_weekly_digest.py: that script summarizes ONE
completed week and accumulates a new story every week. This is a SEASON
summary -- there is no "week" here, just "the season so far," so the slug
is stable per sport and content_hash gates on the full set of game IDs with
a result, same idempotence mechanism, different cadence.

WHAT COUNTS AS "NOTABLE": a win over a ranked opponent, detected from
gojacks.com's own ranking-prefix convention on the opponent name ("#1
Nebraska", "RV Villanova", "No. 3 South Dakota" -- see
scrapers/parsers/gojacks_v1.py:normalize_opponent()). This is REAL,
source-provided information about the OPPONENT's ranking. It is NOT the
same as SDSU's own poll ranking, which this pipeline has no data source
for -- the brief's "record, notable results, ranking, what's next" is
deliberately scoped down to what's actually verifiable: a source-labeled
opponent's ranking, not an invented one for SDSU itself. See
NEEDS-HUMAN-REVIEW.md for this disclosed scope reduction.

Körning:
    python -m ai_pipeline.jackrabbits_season_digest --config configs/brookings_sd.json
    python -m ai_pipeline.jackrabbits_season_digest --config configs/brookings_sd.json --force
    python -m ai_pipeline.jackrabbits_season_digest --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails
from validation import pre_publish_check
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)
from scrapers.parsers.gojacks_v1 import normalize_opponent

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

SOURCE_TYPE = "jackrabbits_season_summary"
MIN_WORDS = 40

SPORT_LABELS = {"mbb": "men's basketball", "wbb": "women's basketball"}


def _label(sport: str) -> str:
    return SPORT_LABELS.get(sport, sport.replace("_", " "))


def gather_sport_stats(conn, town_id: str) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, sport, opponent, home_away, starts_at, venue, result
              FROM sports_games
             WHERE town_id = %s
             ORDER BY sport, starts_at
            """,
            (town_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]

    by_sport: dict[str, dict] = {}
    for r in rows:
        sport = r["sport"]
        entry = by_sport.setdefault(sport, {
            "sport": sport, "wins": 0, "losses": 0, "ties": 0,
            "ranked_wins": [], "played_ids": [], "next_game": None,
        })
        is_ranked_opponent = normalize_opponent(r["opponent"]) != r["opponent"]
        if r["result"]:
            entry["played_ids"].append(r["id"])
            outcome = r["result"].strip()[:1].upper()
            if outcome == "W":
                entry["wins"] += 1
                if is_ranked_opponent:
                    entry["ranked_wins"].append(r)
            elif outcome == "L":
                entry["losses"] += 1
            elif outcome == "T":
                entry["ties"] += 1
        elif entry["next_game"] is None:
            # rows are ordered by starts_at, so the first result-less row
            # encountered per sport is the soonest upcoming game
            entry["next_game"] = r

    # Only sports with at least one played game so far -- a pure future
    # schedule with nothing to summarize yet isn't a "season so far."
    return [v for v in by_sport.values() if v["wins"] + v["losses"] + v["ties"] > 0]


def content_hash(stats: dict) -> str:
    ids = sorted(str(i) for i in stats["played_ids"])
    return hashlib.sha256("|".join(ids).encode()).hexdigest()


def build_grounding_text(stats: dict) -> str:
    label = _label(stats["sport"])
    record = f"{stats['wins']}-{stats['losses']}" + (f"-{stats['ties']}" if stats["ties"] else "")
    parts = [f"SPORT: SDSU Jackrabbits {label}", f"SEASON RECORD SO FAR: {record}"]
    if stats["ranked_wins"]:
        parts.append("\nWINS OVER RANKED OPPONENTS (per gojacks.com's own ranking labels "
                      "on the opponent, not SDSU's own ranking, which is not in this data):")
        for g in stats["ranked_wins"]:
            where = f" at {g['venue']}" if g["venue"] else ""
            parts.append(f"- beat {g['opponent']} {g['result']}{where}")
    next_game = stats["next_game"]
    if next_game:
        vs = "vs" if next_game["home_away"] == "home" else "at"
        when = next_game["starts_at"].isoformat() if next_game["starts_at"] else "date TBA"
        where = f" ({next_game['venue']})" if next_game["venue"] else ""
        parts.append(f"\nNEXT GAME: {vs} {next_game['opponent']}{where}, {when}")
    else:
        parts.append("\nNEXT GAME: none scheduled/remaining")
    return "\n".join(parts)


def build_prompt(cfg: dict, sport_label: str) -> str:
    return build_system_prompt(cfg) + f"""

FORMAT OVERRIDE -- JACKRABBITS SEASON SUMMARY ({sport_label}):
Write a short standing summary (2-3 short paragraphs) of the SDSU Jackrabbits
{sport_label} season so far, from the source data below. This is not a weekly
recap -- it covers the whole season to date, and will be regenerated as the
season continues, so don't reference "this week."

STRUCTURE:
- State the season record explicitly (e.g. "12-3 this season").
- If there are wins over ranked opponents in the source data, lead with the
  most notable one -- that's the real story of a season. Do not describe
  SDSU's OWN ranking or postseason chances; the source data does not include
  SDSU's own poll ranking, only the labeled ranking of opponents SDSU beat.
- Close with the next scheduled game if one is given, in one sentence.
- If there are no ranked-opponent wins, just report the record plainly --
  do not invent a notable moment that isn't in the source data.

Return ONLY the article text. No preamble, no title."""


def template_fallback(stats: dict) -> str:
    label = _label(stats["sport"])
    record = f"{stats['wins']}-{stats['losses']}" + (f"-{stats['ties']}" if stats["ties"] else "")
    lines = [f"The Jackrabbits {label} team is {record} this season."]
    for g in stats["ranked_wins"]:
        lines.append(f"Notable win: {g['result']} over {g['opponent']}.")
    next_game = stats["next_game"]
    if next_game:
        vs = "vs" if next_game["home_away"] == "home" else "at"
        lines.append(f"Next up: {vs} {next_game['opponent']}.")
    return " ".join(lines)


def generate(stats: dict, cfg: dict, client=None) -> tuple[str, str, bool]:
    label = _label(stats["sport"])
    src = build_grounding_text(stats)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))

    if _spent_this_month() >= cap:
        return template_fallback(stats), "template_fallback", True

    if client is None:
        if anthropic is None:
            return template_fallback(stats), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model(SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_prompt(cfg, label)

    def call(extra: str = "") -> str:
        msg = safe_create(
            client,
            model=model, max_tokens=600, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    def _checks_pass(candidate: str) -> tuple[bool, list[str]]:
        result = guardrails.validate(candidate, src, cfg)
        violations = list(result.violations)
        if not violations:
            # Phase 0 gate (validation/pre_publish_check.py). No record_date:
            # a season-to-date summary has no single record date to check
            # relative-day words against.
            violations = pre_publish_check(
                candidate, source_records=stats, cfg=cfg, content_type=SOURCE_TYPE,
            ).violations
        return not violations, violations

    try:
        text = call()
        passed, violations = _checks_pass(text)
        if not passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or described SDSU's own ranking (not in the source). "
                        "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
            passed, violations = _checks_pass(text)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return template_fallback(stats), "template_fallback", True

    if passed and len(text.split()) >= MIN_WORDS:
        return text, f"ai:{model}", True

    reason = "guardrail" if not passed else "too short"
    print(f"  faller tillbaka på mall ({reason})")
    if not passed:
        for v in violations[:5]:
            print(f"    - {v}")
    return template_fallback(stats), "template_fallback", True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="generera och skriv ut, men skriv INTE till stories "
                         "(gör ett riktigt AI-anrop -- kostar samma som en publicering)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        all_stats = gather_sport_stats(conn, town_id)
        if not all_stats:
            print("  inga spelade matcher ännu -- ingen sammanfattning att skriva")
            return 0

        for stats in all_stats:
            sport = stats["sport"]
            slug = f"jackrabbits-season-summary-{sport}"
            new_hash = content_hash(stats)

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s",
                    (town_id, slug))
                row = cur.fetchone()

            if row and row[0] == new_hash and not args.force and not args.dry_run:
                print(f"  {sport}: underlaget oförändrat -- hoppar över")
                continue

            text, generated_by, verified = generate(stats, cfg)
            # AdSense remediation Phase B2: no town-name prefix -- see
            # ai_pipeline/daily_content.py's own comment on why.
            title = f"SDSU Jackrabbits {_label(sport)}: season so far"

            if args.dry_run:
                print("\n" + "=" * 70)
                print(f"SPORT: {sport}  |  GENERATED_BY: {generated_by}  |  {len(text.split())} ord")
                print("=" * 70)
                print(text)
                print("=" * 70)
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO stories
                        (town_id, title, slug, body, source_type, occurs_at,
                         generated_by, verified, content_hash, published_at, byline)
                    VALUES (%s,%s,%s,%s,%s, now(), %s,%s,%s, now(),'AI-generated')
                    ON CONFLICT (town_id, slug) DO UPDATE SET
                        title = EXCLUDED.title,
                        body = EXCLUDED.body,
                        generated_by = EXCLUDED.generated_by,
                        verified = EXCLUDED.verified,
                        content_hash = EXCLUDED.content_hash,
                        published_at = now()
                    """,
                    (town_id, title, slug, text, SOURCE_TYPE,
                     generated_by, verified, new_hash))
            conn.commit()
            action = "uppdaterad" if row else "skapad"
            print(f"  {sport}: {action} ({len(text.split())} ord, {generated_by})")

        if args.dry_run:
            print("\n(dry-run -- INGET skrevs till stories)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
