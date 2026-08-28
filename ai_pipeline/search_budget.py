"""Hard, DB-backed request ceiling for paid search APIs (Brave Search).

See Handoff: Information Hub Tier 1, Feature B §3.4. This directly guards
against the exact class of bug already shipped once in this codebase:
db.py:last_run_at's own docstring documents that `refresh_minutes` sat in
every data source's config, read by nothing, for a long time -- "existed in
config" and "enforced in code" are not the same claim, and only the second
one actually stops a paid API from being hammered. ai_pipeline/
new_in_town_digest.py MUST call reserve_request() before every single Brave
Search call and skip the search entirely on a False return -- never search
first and account for it after, and never just log a warning and continue.

Uses the database, not a local JSON file (the pattern ai_pipeline/
format_prompt.py's AI-spend tracker uses via AI_BUDGET_STATE): a GitHub
Actions runner starts from a fresh checkout every scheduled run, so a local
file always reads back as "zero spent so far" -- a "monthly" ceiling backed
by that would silently do nothing across the very runs it's supposed to
constrain. The database is the one store this pipeline already has that
persists across runs AND is visible across every town's separate workflow,
which the GLOBAL ceiling below needs.
"""
from __future__ import annotations

from datetime import date

# Hard ceiling across ALL towns combined, regardless of how many enable this
# feature -- see Handoff §3.4 ("a global ceiling across all towns"). This is
# explicitly cross-town, so it isn't a per-town config value; a single
# shared constant is the config surface for it. At $5/1000 requests, 150/mo
# is $0.75/mo worst case across the whole fleet.
GLOBAL_MONTHLY_REQUEST_CEILING = 150


def _period(today: date | None = None) -> date:
    return (today or date.today()).replace(day=1)


def reserve_request(conn, town_id: str, per_town_ceiling: int,
                     provider: str = "brave", today: date | None = None) -> bool:
    """Atomically checks BOTH the per-town and global ceilings and, only if
    neither is already at or over its limit, records one more request and
    returns True. Returns False -- recording NOTHING -- the instant either
    ceiling would be exceeded; the caller must treat False as "do not make
    this search call," not as an FYI to log past. A row lock (FOR UPDATE) on
    this town's own counter row keeps two runs that happen to overlap from
    both squeaking through past the edge of the ceiling.
    """
    period = _period(today)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO search_request_log (town_id, provider, period, request_count)
            VALUES (%s, %s, %s, 0)
            ON CONFLICT (town_id, provider, period) DO NOTHING
            """,
            (town_id, provider, period),
        )
        cur.execute(
            "SELECT request_count FROM search_request_log "
            "WHERE town_id = %s AND provider = %s AND period = %s FOR UPDATE",
            (town_id, provider, period),
        )
        town_count = cur.fetchone()[0]

        cur.execute(
            "SELECT COALESCE(sum(request_count), 0) FROM search_request_log "
            "WHERE provider = %s AND period = %s",
            (provider, period),
        )
        global_count = cur.fetchone()[0]

        if town_count >= per_town_ceiling or global_count >= GLOBAL_MONTHLY_REQUEST_CEILING:
            return False

        cur.execute(
            "UPDATE search_request_log SET request_count = request_count + 1 "
            "WHERE town_id = %s AND provider = %s AND period = %s",
            (town_id, provider, period),
        )
    conn.commit()
    return True


def requests_this_month(conn, town_id: str, provider: str = "brave", today: date | None = None) -> int:
    """For visibility -- see Handoff §3.4 ('log actual request counts per
    run so the spend is visible without opening the Brave dashboard')."""
    period = _period(today)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT request_count FROM search_request_log "
            "WHERE town_id = %s AND provider = %s AND period = %s",
            (town_id, provider, period),
        )
        row = cur.fetchone()
    return row[0] if row else 0
