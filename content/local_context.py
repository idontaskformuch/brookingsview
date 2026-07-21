"""Bygger lokalt underlag för krönike-/ledarmodulerna ur redan skrapad, publicerad
och guardrail-godkänd data i `stories`.

Varför inte ett påhittat scenario: en krönika/ledare ska ha en anledning att
existera just den här veckan (se CONTENT_MODULES.md), och grundas i något som
faktiskt hänt i Brookings, inte i ett plausibelt låtande men overifierat
scenario. `stories`-raderna för meeting/event har redan passerat
ai_pipeline.guardrails extraktiva validering, så de är ett säkert substrat att
bygga vidare på.
"""
from __future__ import annotations

from psycopg.rows import dict_row

LOOKBACK_DAYS = 14
MAX_ITEMS = 15


def recent_local_stories(conn, town_id: str, lookback_days: int = LOOKBACK_DAYS,
                          limit: int = MAX_ITEMS) -> list[dict]:
    """Real, already-published meeting/event stories from the last N days."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT title, body, source_type, published_at
              FROM stories
             WHERE town_id = %s
               AND source_type IN ('meeting', 'event')
               AND published_at >= now() - make_interval(days => %s)
             ORDER BY published_at DESC
             LIMIT %s
            """,
            (town_id, lookback_days, limit),
        )
        return cur.fetchall()


def build_local_input(stories: list[dict]) -> str | None:
    """Format recent stories into a single underlag block for the AI prompt.

    Returns None if there is nothing to build from -- callers should skip
    generation for today rather than fall back to an invented premise.
    """
    if not stories:
        return None
    lines = [
        "UNDERLAG: det senaste från Brookings, South Dakota (redan publicerat "
        "och faktakontrollerat). Välj EN vinkel eller tes ur det som följer, "
        "väv inte in allt:",
        "",
    ]
    for s in stories:
        lines.append(f"- {s['title']}: {s['body']}")
    return "\n".join(lines)
