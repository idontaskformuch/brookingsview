"""Databas-hjälpare för Brookings View.

Tunn wrapper runt psycopg (v3). Ger:
  - get_conn(): anslutning från DATABASE_URL
  - save_snapshot(): lagra rå källdata + hash, returnera id
  - upsert_records(): dedup-säker insert via content_hash
  - log_run(): starta/avsluta en scrape_run-rad (driver alerting)

Designad för att vara beroende-lätt och köra lika bra lokalt som i GitHub Actions.
"""
from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb

load_dotenv()


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL saknas (sätt i .env eller GitHub Actions secrets)")
    return url


@contextmanager
def get_conn():
    conn = psycopg.connect(_database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _json_dumps(obj: Any) -> str:
    """default=str så date/datetime (vanligt i scrapad källdata) inte kraschar dumpen."""
    return json.dumps(obj, default=str)


def content_hash(*parts: Any) -> str:
    """Stabil hash av de fält som definierar unikhet för en post."""
    payload = "|".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def save_snapshot(conn, town_id: str, source_key: str, url: str | None,
                  raw: bytes, content_type: str) -> int:
    """Lagra rå källdata. Returnerar snapshot-id (för proveniens på stories)."""
    h = sha256_bytes(raw)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO source_snapshots
                (town_id, source_key, url, content_type, raw, content_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (town_id, source_key, url, content_type, raw, h),
        )
        return cur.fetchone()[0]


def upsert_records(conn, table: str, town_id: str, records: Iterable[dict],
                   snapshot_id: int | None = None) -> int:
    """Dedup-säker insert. Varje record MÅSTE ha 'content_hash'.

    ON CONFLICT (town_id, content_hash) DO NOTHING → inga dubbletter.
    Returnerar antalet NYA rader.
    """
    records = list(records)
    if not records:
        return 0

    new_count = 0
    with conn.cursor() as cur:
        for rec in records:
            rec = dict(rec)
            if snapshot_id is not None and "snapshot_id" not in rec:
                rec["snapshot_id"] = snapshot_id
            rec["town_id"] = town_id
            # JSONB-fält
            if "raw_data" in rec and rec["raw_data"] is not None:
                rec["raw_data"] = Jsonb(rec["raw_data"], dumps=_json_dumps)
            if "payload" in rec and rec["payload"] is not None:
                rec["payload"] = Jsonb(rec["payload"], dumps=_json_dumps)

            cols = list(rec.keys())
            placeholders = ", ".join(["%s"] * len(cols))
            collist = ", ".join(cols)
            conflict = "(town_id, content_hash)" if "content_hash" in cols else "(town_id, observed_for)"
            cur.execute(
                f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
                f"ON CONFLICT {conflict} DO NOTHING",
                [rec[c] for c in cols],
            )
            new_count += cur.rowcount
    return new_count


def start_run(conn, town_id: str, source_key: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO scrape_runs (town_id, source_key, status) "
            "VALUES (%s, %s, 'running') RETURNING id",
            (town_id, source_key),
        )
        return cur.fetchone()[0]


def finish_run(conn, run_id: int, status: str, http_code: int | None = None,
               items_found: int = 0, items_new: int = 0, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE scrape_runs
               SET status=%s, http_code=%s, items_found=%s, items_new=%s,
                   error=%s, finished_at=%s
             WHERE id=%s
            """,
            (status, http_code, items_found, items_new, error,
             datetime.now(timezone.utc), run_id),
        )


def consecutive_failures(conn, town_id: str, source_key: str) -> int:
    """Hur många av de senaste körningarna som failat i följd — driver alerting."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status FROM scrape_runs
             WHERE town_id=%s AND source_key=%s
             ORDER BY started_at DESC LIMIT 10
            """,
            (town_id, source_key),
        )
        rows = cur.fetchall()
    n = 0
    for (status,) in rows:
        if status == "error":
            n += 1
        else:
            break
    return n


def ensure_town(conn, cfg: dict) -> None:
    """Skapa/uppdatera town-raden från configen."""
    coords = cfg.get("coordinates", {})
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO towns (town_id, display_name, state, county, population,
                               domain, timezone, lat, lon)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (town_id) DO UPDATE SET
                display_name=EXCLUDED.display_name, domain=EXCLUDED.domain,
                lat=EXCLUDED.lat, lon=EXCLUDED.lon
            """,
            (cfg["town_id"], cfg["display_name"], cfg["state"], cfg.get("county"),
             cfg.get("population"), cfg.get("domain"), cfg.get("timezone"),
             coords.get("lat"), coords.get("lon")),
        )
