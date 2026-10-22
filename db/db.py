"""Databas-hjälpare för Brookings View.

Tunn wrapper runt psycopg (v3). Ger:
  - get_conn(): anslutning från DATABASE_URL
  - save_snapshot(): lagra rå källdata + hash, returnera id
  - upsert_records(): dedup-säker insert via content_hash
  - log_run(): starta/avsluta en scrape_run-rad (driver alerting)
  - record_run(): samma scrape_runs-rad, i ett anrop, för en synkron händelse
    utan en riktig "pågår"-fas (t.ex. en människa som verifierar en plats)

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
                   snapshot_id: int | None = None,
                   conflict_columns: tuple[str, ...] | None = None,
                   update_columns: list[str] | None = None,
                   dedup_check_columns: tuple[str, ...] | None = None,
                   merge_raw_data: bool = False,
                   identity_key: str | None = None) -> int:
    """Dedup-säker insert. Varje record MÅSTE ha 'content_hash' (om inte
    conflict_columns anger något annat).

    Som standard: ON CONFLICT (town_id, content_hash) DO NOTHING → inga
    dubbletter, källdata antas oföränderlig en gång skrapad (möten, event,
    fastighetsförsäljningar, ...).

    conflict_columns/update_columns finns för data som legitimt ÄNDRAS över
    tid för SAMMA post -- t.ex. en sportmatch vars status/resultat går
    scheduled -> live -> final. content_hash skulle då ändras varje gång
    (resultatet är en del av hashen), vilket får ON CONFLICT DO NOTHING att
    aldrig matcha samma rad två gånger och dubblettrader att staplas upp i
    stället för att uppdateras. Ange då en stabil identitet från källan som
    conflict_columns (t.ex. ("town_id", "external_game_id")) och vilka fält
    som ska skrivas över vid en omkörning som update_columns. Standardbeteendet
    (inga argument) är oförändrat för alla befintliga anropare.

    dedup_check_columns är ett EXTRA skyddsnät, oberoende av content_hash --
    en riktig bugg hittad 2026-10-13: en datumparsningsfix (eSCRIBE,
    _parse_escribe_date) ändrade vad content_hash:ade blev för EXAKT samma
    riktiga möte (samma eSCRIBE-ID, samma StartDate-sträng), vilket skapade
    en andra, byte-identisk rad under en ny hash -- ON CONFLICT matchade
    aldrig den gamla raden, eftersom hash:en den jämförde mot hade ändrats.
    När satt (t.ex. ("body", "meeting_date") för möten): om en BEFINTLIG
    rad redan finns för (town_id, *dedup_check_columns) med SEMANTISKT
    identisk raw_data (Postgres JSONB-likhet -- ignorerar nyckelordning/
    whitespace) hoppas posten över helt, oavsett vad content_hash säger. En
    genuint ändrad omskrapning (ny PostMinutes, ny Action Summary) har
    alltid ANNORLUNDA raw_data och fångas aldrig av detta -- bara en
    verklig byte-för-byte-dubblett gör.

    merge_raw_data (default False, dvs. oförändrat beteende för alla
    befintliga anropare): styr HUR raw_data-kolumnen skrivs vid en
    DO UPDATE. False = total ersättning (raw_data = EXCLUDED.raw_data),
    samma som idag. True = en ytlig jsonb-sammanslagning
    (raw_data = {table}.raw_data || EXCLUDED.raw_data) -- en nyckel som
    finns i BÅDA tar det NYA värdet (en riktig omröstning/action-summary-
    uppdatering fungerar precis som förut), men en nyckel som bara finns
    i den GAMLA raden bevaras istället för att försvinna.

    Verklig bugg detta fixar (hittad 2026-10-15, se .claude/state.md):
    legistar_v1.py/agendalink_v1.py/escribe_v1.py sätter bara
    raw_data["agenda_items"]/["agenda_text"] NÄR hämtningen gav några
    ärenden -- om källan en dag svarar tomt för ett event som tidigare
    HADE ärenden (bekräftat live: Legistar slutar exponera ärende-nivå-
    detalj för ett event runt 51-58 dagars ålder, oberoende av vårt eget
    60-dagarsfönster), skrev den gamla totala ersättningen bort den
    rikare historiska datan permanent, första gången det hände.

    AVVÄGNING, medvetet accepterad: om källan en dag MEDVETET tar bort
    ett ärende (en genuin rättelse, inte bara en tillfälligt tom
    API-sida) kommer det gamla ärendet att leva kvar här ändå -- en
    sammanslagning kan bara LÄGGA TILL/BEVARA nycklar, aldrig ta bort en
    nyckel den gamla raden redan hade. Detta är avsiktligt: att bevara
    en möjligen inaktuell historisk rad är ett mindre fel än att tyst
    tappa ett ärende en läsare redan kunnat se, och matchar samma
    "behåll data, sluta visa den" -princip resten av kodbasen redan
    använder för dubblett-hantering (superseded_by_slug) snarare än att
    radera.

    Opt-in, inte default: ~10 andra befintliga anropare (traffic, sport,
    events, fastighetsförsäljningar m.fl.) sätter redan raw_data i sin
    update_columns och förlitar sig på total ersättning för FÄLT SOM
    LEGITIMT SKA FÖRSVINNA (t.ex. en pågående-match-markör som inte
    längre är relevant när matchen är klar) -- en global sammanslagning
    där skulle vara en annan, oavsiktlig bugg. Bara de tre mötesskraperna
    sätter merge_raw_data=True (se BaseParser-flaggan med samma namn).

    identity_key (default None = oförändrat beteende): namnet på en nyckel i
    raw_data som är källans EGEN stabila id för posten (eSCRIBE "ID",
    Legistar "EventId", AgendaLink "id"). När satt och posten har ett värde
    för den slås raden upp på (town_id, raw_data->>identity_key) INNAN
    content_hash tittas på: finns den uppdateras den ÄLDSTA matchande raden
    (update_columns, med merge_raw_data om satt) i stället för att en ny
    infogas. content_hash är inte en identitet -- den ändras när hash-
    indatan ändras (meetings 13779-13791, Moreno, 2026-10-01: en tidszonsfix
    ändrade hashen för 13 redan lagrade möten, varje omskrapning infogade en
    ny dubblettrad; samma sak hände igen 15 och 20 okt, där raw_data skilde
    så dedup_check_columns inte fångade dem). content_hash på den uppdaterade
    raden sätts till postens nya hash BARA om ingen annan rad redan har den
    (UNIQUE (town_id, content_hash) -- en kvarvarande dubblett kan hålla den).
    Utan update_columns görs ingenting för en befintlig rad (som DO NOTHING).
    Raden räknas som 1 i returvärdet vid uppdatering, precis som DO UPDATE
    gjorde tidigare, så scrape_runs.items_new betyder detsamma.
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

            if identity_key is not None and isinstance(rec.get("raw_data"), dict):
                identity = rec["raw_data"].get(identity_key)
                if identity is not None:
                    # identity_aliases (valfri lista i raw_data): tidigare id:n som
                    # SAMMA post kan ha lagrats under (Glasgow/CoInS: ett möte får
                    # sitt egna id först när agendan publiceras).
                    ids = [str(identity), *map(str, rec["raw_data"].get("identity_aliases") or [])]
                    cur.execute(
                        f"SELECT id FROM {table} WHERE town_id = %s "
                        f"AND raw_data->>%s = ANY(%s) ORDER BY id LIMIT 1",
                        [town_id, identity_key, ids],
                    )
                    existing = cur.fetchone()
                    if existing:
                        new_count += _update_by_identity(
                            cur, table, town_id, existing[0], rec,
                            update_columns, merge_raw_data)
                        continue

            if (dedup_check_columns is not None and rec.get("raw_data") is not None
                    and all(c in rec for c in dedup_check_columns)):
                where = " AND ".join(f"{c} = %s" for c in dedup_check_columns)
                cur.execute(
                    f"SELECT 1 FROM {table} WHERE town_id = %s AND {where} "
                    f"AND raw_data = %s::jsonb LIMIT 1",
                    [town_id, *[rec[c] for c in dedup_check_columns], _json_dumps(rec["raw_data"])],
                )
                if cur.fetchone():
                    label = ", ".join(f"{c}={rec[c]}" for c in dedup_check_columns)
                    print(f"  [dedup] hoppar över byte-identisk dubblett: {table} ({label})")
                    continue

            # JSONB-fält
            if "raw_data" in rec and rec["raw_data"] is not None:
                rec["raw_data"] = Jsonb(rec["raw_data"], dumps=_json_dumps)
            if "payload" in rec and rec["payload"] is not None:
                rec["payload"] = Jsonb(rec["payload"], dumps=_json_dumps)

            cols = list(rec.keys())
            placeholders = ", ".join(["%s"] * len(cols))
            collist = ", ".join(cols)
            if conflict_columns is not None:
                conflict = "(" + ", ".join(conflict_columns) + ")"
            else:
                conflict = "(town_id, content_hash)" if "content_hash" in cols else "(town_id, observed_for)"

            if update_columns:
                def _set_clause(c: str) -> str:
                    if c == "raw_data" and merge_raw_data:
                        return f"raw_data = {table}.raw_data || EXCLUDED.raw_data"
                    return f"{c} = EXCLUDED.{c}"
                action = "DO UPDATE SET " + ", ".join(_set_clause(c) for c in update_columns)
            else:
                action = "DO NOTHING"

            cur.execute(
                f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
                f"ON CONFLICT {conflict} {action}",
                [rec[c] for c in cols],
            )
            new_count += cur.rowcount
    return new_count


def _update_by_identity(cur, table: str, town_id: str, row_id: int, rec: dict,
                        update_columns: list[str] | None, merge_raw_data: bool) -> int:
    """UPDATE-halvan av upsert_records(identity_key=...) -- se dess docstring."""
    if not update_columns:
        return 0
    sets, params = [], []
    for c in update_columns:
        if c not in rec:
            continue
        value = rec[c]
        if c in ("raw_data", "payload") and value is not None:
            value = Jsonb(value, dumps=_json_dumps)
        if c == "raw_data" and merge_raw_data:
            sets.append(f"raw_data = COALESCE({table}.raw_data, '{{}}'::jsonb) || %s")
        else:
            sets.append(f"{c} = %s")
        params.append(value)
    if "content_hash" in rec:
        sets.append(
            "content_hash = CASE WHEN NOT EXISTS (SELECT 1 FROM "
            f"{table} o WHERE o.town_id = %s AND o.content_hash = %s AND o.id <> %s) "
            "THEN %s ELSE content_hash END")
        params += [town_id, rec["content_hash"], row_id, rec["content_hash"]]
    if not sets:
        return 0
    cur.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id = %s", [*params, row_id])
    return cur.rowcount


def start_run(conn, town_id: str, source_key: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO scrape_runs (town_id, source_key, status) "
            "VALUES (%s, %s, 'running') RETURNING id",
            (town_id, source_key),
        )
        return cur.fetchone()[0]


def finish_run(conn, run_id: int, status: str, http_code: int | None = None,
               items_found: int = 0, items_new: int = 0, error: str | None = None,
               docs_attempted: int = 0, docs_failed: int = 0,
               docs_last_error: str | None = None) -> None:
    """docs_attempted/docs_failed/docs_last_error: per-document fetch attempts
    WITHIN an otherwise-successful run (e.g. escribe_v1's agenda/minutes/
    action-summary PDFs) -- separate from `error`, which is this function's
    caller's own top-level exception for the run as a whole. Before this,
    a per-document fetch failure only reached a print() (see escribe_v1.py/
    legistar_v1.py's own try/except around each document request), so a run
    that fetched 0 of N documents still logged status='ok' here -- see
    scrapers/runner.py:run_source(), which downgrades status to 'degraded'
    when docs_attempted > 0 and every attempt failed."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE scrape_runs
               SET status=%s, http_code=%s, items_found=%s, items_new=%s,
                   error=%s, docs_attempted=%s, docs_failed=%s,
                   docs_last_error=%s, finished_at=%s
             WHERE id=%s
            """,
            (status, http_code, items_found, items_new, error,
             docs_attempted, docs_failed, docs_last_error,
             datetime.now(timezone.utc), run_id),
        )


def record_run(conn, town_id: str, source_key: str, status: str, *,
               http_code: int | None = None, items_found: int = 0,
               items_new: int = 0, error: str | None = None,
               docs_attempted: int = 0, docs_failed: int = 0,
               docs_last_error: str | None = None) -> int:
    """Broomfield place-layer handoff, Section 4.1's own "coverage-log /
    record_run() wrapper" -- confirmed live (see NEEDS-HUMAN-REVIEW.md) that
    this table and start_run()/finish_run() ALREADY are that wrapper, used by
    every scraper via scrapers/runner.py since before this spec existed.
    Building a second, parallel run-log table would just be the same
    tracking duplicated, with a real risk of the two silently drifting apart.

    This is the one genuinely missing piece: start_run()+finish_run() are
    shaped for a live scraper's real async fetch-then-parse-later flow (a
    row exists in 'running' state while work happens). A human confirming a
    place's hours against its own official page is a single, synchronous
    event with no "in progress" state worth recording -- record_run() is
    that one-call shape, composing the SAME table and the SAME
    last_run_at()/consecutive_failures() queries every other source already
    relies on for staleness/alerting, not a second mechanism.

    source_key convention for place verification: "place:<slug>" -- staleness
    is inherently PER PLACE (each has its own place_type threshold, its own
    source_url), not per scraper-source the way every other caller of this
    table is, so last_run_at(conn, town_id, f"place:{slug}") is the real
    per-place signal the place-detail page's staleness downgrade reads.

    status: 'ok' | 'error' | 'stub' | 'skipped' (see scrape_runs' own
    schema.sql comment) for anything that went through a real fetch --
    'manual' for a human-verified entry with no HTTP fetch behind it (the
    normal case for place seeding, at least until an automated re-scrape of
    place sources exists, if one ever does).
    """
    run_id = start_run(conn, town_id, source_key)
    finish_run(conn, run_id, status=status, http_code=http_code,
               items_found=items_found, items_new=items_new, error=error,
               docs_attempted=docs_attempted, docs_failed=docs_failed,
               docs_last_error=docs_last_error)
    return run_id


def last_run_at(conn, town_id: str, source_key: str) -> datetime | None:
    """Starttiden för senaste körningen av en källa, oavsett utfall.

    Driver refresh_minutes-spärren i runner.py:run_source() -- utan den
    kördes VARJE aktiverad källa om vid VARJE schemalagd scrape.yml-körning
    (en gång/timme), oavsett vad configen råkade ange för refresh_minutes
    (fältet lästes aldrig av koden, bara dokumenterande). Ofarligt för gratis-
    /högtak-API:er (MLB Stats API, Caltrans, Thrillshare -- content_hash-
    dedupen gjorde de flesta om-körningarna till no-ops ändå), men förödande
    för en nyckelbegränsad betal-/kvot-API som Adzuna (~33 anrop/dag på
    gratisnivån) -- upptäckt 2026-08-10 innan jobs_v1.py byggdes, se
    scrapers/parsers/jobs_v1.py.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT started_at FROM scrape_runs
             WHERE town_id=%s AND source_key=%s
             ORDER BY started_at DESC LIMIT 1
            """,
            (town_id, source_key),
        )
        row = cur.fetchone()
    return row[0] if row else None


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
            (cfg["town_id"], cfg["display_name"], cfg.get("state") or cfg.get("region"), cfg.get("county"),
             cfg.get("population"), cfg.get("domain"), cfg.get("timezone"),
             coords.get("lat"), coords.get("lon")),
        )
