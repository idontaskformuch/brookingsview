"""Publish-pipeline -- Stage 3 (AI-formatering) -> stories.

Går igenom rader i källtabellerna (meetings, events), formaterar dem via
ai_pipeline.format_prompt, och skriver resultatet till `stories` med full
proveniens (source_url, snapshot_id, generated_by, verified).

Idempotent: en deterministisk slug kombinerat med den redan existerande
UNIQUE(town_id, slug)-constrainten gör att en omkörning varken skapar dubbletter
eller spenderar AI-budget på redan publicerade rader -- existerande slugs kollas
INNAN format_record() anropas, inte efter.

Fem kvalitetsregler tillkomna efter granskning av de första 215 storyna:

1. SLOT-GRUPPERING. Biblioteket lägger ut samma event som flera tidsluckor
   ("Triassic Trek Escape Room- Slot 2", "- Slot 6" ...). Publicerade var för sig
   gav det sex nästan identiska sidor -- exakt den "scaled content"-signal som
   fällde vertoq.net hos AdSense. Slots kollapsas nu till EN story med flera tider.

2. SUBSTANSKRAV. Ett möte utan agendainnehåll gav texter som "residents can review
   the full agenda online" -- innehållslöst för läsaren och skadligt för
   sidkvaliteten. Möten utan agendatext publiceras inte alls; de finns kvar i
   `meetings` som kalenderdata. (Legistar-möten saknar agendatext i nuläget --
   riktiga fixen är att hämta /events/{id}/eventitems från Legistars WebAPI.)

3. VARNINGAR SKILJS FRÅN EVENEMANG. NWS- och county-varningar låg i events-tabellen
   och blev source_type='event', dvs. hamnade bland broderikurser. De får nu
   source_type='alert' så frontend kan rendera dem som varningsbanner.

4. STRUKTURERAD DATA PUBLICERAS INTE SOM STORIES. Sport, väder och råvarupriser
   gav 115 av 169 stories -- nästan identiska mallrader ("The SDSU Jackrabbits
   play X at home on DATE"). Det är samma scaled content-signal som slot-
   dubbletterna, fast i större skala. De läses nu direkt från sina källtabeller
   av frontend (tabell på /jackrabbits, rutor på startsidan) istället för att bli
   indexerade sidor. `stories` innehåller enbart redaktionellt innehåll.

5. VARNINGAR HAR ETT BÄST-FÖRE-DATUM. County:ts Alert Center rensar aldrig gamla
   poster, så en vägavstängning från 2023 låg kvar och publicerades som aktuell
   (upptäckt och städat i efterhand med db/migrations/002_occurs_at.sql). En
   varning som passerat sitt ends_at (eller, om det saknas, är äldre än
   _ALERT_MAX_AGE_DAYS) publiceras nu inte alls -- den är en INSTRUKTION, inte
   ett arkiv, så inaktuell är aktivt skadlig snarare än bara omodern.

KÄND BEGRÄNSNING (slot-gruppering): sluggen härleds från gruppens lägsta rad-id.
Om en NY tidslucka läggs till ett redan publicerat event ändras inte sluggen, så
storyn uppdateras inte med den nya tiden. Sällsynt; åtgärdas genom att radera den
storyn och köra om.

Körning:
    python -m ai_pipeline.publish --config configs/brookings_sd.json
    python -m ai_pipeline.publish --config configs/brookings_sd.json --only meetings events
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline.format_prompt import format_record, TEMPLATERS

SOURCES: dict[str, str] = {
    "meetings": "meeting",
    "events": "event",
}

# "Triassic Trek Escape Room- Slot 2" -> "Triassic Trek Escape Room"
_SLOT_RE = re.compile(r"\s*[-–—]\s*slot\s+\d+\s*$", re.IGNORECASE)

# källor i events-tabellen som EGENTLIGEN är varningar, inte evenemang
_ALERT_SOURCES = {"nws_alert", "county_alert"}

# minsta agendatext för att ett möte ska vara värt en egen story
_MIN_AGENDA_CHARS = 200

# databas-bokföringsfält som SELECT * drar med sig men som AI-lagret aldrig
# ska se (rena DB-interna, inget en läsare eller modellen har nytta av)
_INTERNAL_FIELDS = {"id", "town_id", "content_hash", "snapshot_id", "created_at"}

# Varningar äldre än detta publiceras inte. County:ts Alert Center rensar aldrig
# gamla poster, så en vägavstängning från 2023 låg kvar och lästes som aktuell.
_ALERT_MAX_AGE_DAYS = 14

# Skydd mot stora engångsbackfyllningar (t.ex. en nyaktiverad källa med historik,
# eller en bugfix i en parser som plötsligt släpper igenom hundratals rader som
# tidigare tystades -- exakt vad som hände när Tockify-ICS-buggen fixades för
# Moreno Valley: 0 -> 1004 events i en enda scrape-körning). Utan tak blir varje
# NY rad ett synkront AI-anrop i en enkel for-loop -- en körning kan då ta väldigt
# lång tid och kosta mycket på en gång, och riskerar att GitHub Actions-jobbet
# time:ar ut. Kvarvarande rader är inte förlorade: known_slugs uppdateras bara
# för faktiskt publicerade rader, så nästa schemalagda körning fortsätter där
# denna slutade -- självläkande över tid, inte en engångsgräns som tappar data.
DEFAULT_MAX_NEW_PER_RUN = 50


def strip_slot(title: str) -> tuple[str, bool]:
    """Returnerar (bastitel, var_en_slot)."""
    base = _SLOT_RE.sub("", title or "").strip()
    return (base or title or "", base != (title or "").strip())


def fmt_dt(value, with_time: bool = False) -> str | None:
    """Formatera datum läsbart. Tar datetime ELLER sträng."""
    if value is None:
        return None
    dt = value
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return dt
    if not isinstance(dt, datetime):
        return str(dt)
    # %-d/%-I (icke-nollutfyllda dag/timme) är Linux/macOS-specifika strftime-flaggor
    # -- kraschar med ValueError på Windows. Bygg strängen manuellt istället, så det
    # fungerar lika bra lokalt (Windows) som i GitHub Actions (ubuntu-latest).
    date_part = f"{dt.strftime('%a, %b')} {dt.day}, {dt.year}"
    return f"{date_part} at {_fmt_hour_min(dt)}" if with_time else date_part


def fmt_time(value) -> str | None:
    if value is None:
        return None
    dt = value
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return dt
    if not isinstance(dt, datetime):
        return str(dt)
    return _fmt_hour_min(dt)


def _fmt_hour_min(dt: datetime) -> str:
    hour12 = dt.hour % 12 or 12
    return f"{hour12}:{dt.strftime('%M %p')}"


def has_substance(table: str, row: dict) -> bool:
    """Är raden värd en egen publicerad story?

    Hellre ingen story än en innehållslös. Tunt innehåll skadar både läsaren och
    sidkvaliteten (jfr. AdSense 'low value content').
    """
    if table != "meetings":
        return True
    raw = row.get("raw_data") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    agenda = (raw.get("agenda_text") or "").strip()
    return len(agenda) >= _MIN_AGENDA_CHARS


def resolve_source_type(table: str, row: dict) -> str:
    if table == "events" and (row.get("source") or "") in _ALERT_SOURCES:
        return "alert"
    return SOURCES[table]


def _as_aware(value):
    """Normalisera till tz-medveten datetime. Tar datetime, ISO-sträng eller None."""
    if value is None:
        return None
    dt = value
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(dt, datetime):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_current(source_type: str, row: dict) -> bool:
    """Är posten fortfarande aktuell nog att publiceras?

    Gäller bara varningar. En varning är en INSTRUKTION ("planera en annan väg"),
    så en inaktuell varning är aktivt skadlig -- till skillnad från ett passerat
    evenemang eller möte, som bara är arkiv och tydligt daterat.
    """
    if source_type != "alert":
        return True
    now = datetime.now(timezone.utc)
    ends = _as_aware(row.get("ends_at"))
    if ends is not None:
        return ends >= now
    starts = _as_aware(row.get("starts_at"))
    if starts is None:
        return False
    return starts >= now - timedelta(days=_ALERT_MAX_AGE_DAYS)


def build_occurs_at(table: str, row: dict):
    """När händelsen faktiskt äger rum -- inte när vi skrev om den."""
    if table == "meetings":
        return row.get("meeting_date")
    if table == "events":
        return row.get("starts_at")
    return None


def build_title(table: str, row: dict) -> str:
    if table == "meetings":
        body = row.get("body") or "Meeting"
        when = fmt_dt(row.get("meeting_date"))
        return f"{body} — {when}" if when else str(body)
    if table == "events":
        base, _ = strip_slot(row.get("title") or "Event")
        return base
    return "Update"


def build_source_url(table: str, row: dict) -> str | None:
    if table == "meetings":
        return row.get("agenda_url")
    if table == "events":
        return row.get("url")
    return None


def group_event_slots(rows: list[dict]) -> list[dict]:
    """Kollapsa flera tidsluckor av samma event samma dag till en post.

    Grupperingsnyckel: (bastitel, datum, källa). Olika DATUM förblir separata
    stories -- samma escape room i juni och i september är två händelser.
    """
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for row in rows:
        base, _ = strip_slot(row.get("title") or "")
        starts = row.get("starts_at")
        day = starts.date().isoformat() if isinstance(starts, datetime) else str(starts)[:10]
        key = (base.lower(), day, row.get("source"))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    merged: list[dict] = []
    for key in order:
        members = sorted(groups[key], key=lambda r: (r.get("starts_at") or datetime.max, r["id"]))
        base_row = dict(members[0])
        base_row["id"] = min(m["id"] for m in members)
        if len(members) > 1:
            times = [t for t in (fmt_time(m.get("starts_at")) for m in members) if t]
            base_row["slot_times"] = times
            base_row["slot_count"] = len(members)
            base_row["title"], _ = strip_slot(base_row.get("title") or "")
        merged.append(base_row)
    return merged


def existing_slugs(conn, town_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug FROM stories WHERE town_id = %s", (town_id,))
        return {r[0] for r in cur.fetchall()}


def publish_table(
    conn, cfg: dict, table: str, known_slugs: set[str], max_new: int = DEFAULT_MAX_NEW_PER_RUN
) -> tuple[int, int, int, int, int]:
    town_id = cfg["town_id"]
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT * FROM {table} WHERE town_id = %s ORDER BY id", (town_id,))
        rows = [dict(r) for r in cur.fetchall()]

    if table == "events":
        rows = group_event_slots(rows)

    published = skipped = thin = stale = remaining = 0
    for row in rows:
        if not has_substance(table, row):
            thin += 1
            continue

        source_type = resolve_source_type(table, row)

        # varningar har ett bäst-före-datum en agenda/eventbeskrivning inte har
        # -- se is_current(). Kollas innan slug/AI så en inaktuell varning
        # aldrig ens hinner formateras.
        if not is_current(source_type, row):
            stale += 1
            continue

        slug = f"{source_type}-{row['id']}"
        if slug in known_slugs:
            skipped += 1
            continue

        # TAK PER KÖRNING (se DEFAULT_MAX_NEW_PER_RUN): redan publicerade rader
        # ovan fortsätter skippas korrekt oavsett tak. Bara NYA rader räknas mot
        # det, och de som inte hinner med i denna körning lämnas orörda (INTE i
        # known_slugs) så nästa schemalagda körning plockar upp dem.
        if published >= max_new:
            remaining += 1
            continue

        # SELECT * (se moduldocstring) drar med sig databas-bokföring (id,
        # town_id, content_hash, snapshot_id, created_at) som INTE ska in i
        # AI-prompten -- guardrails.source_to_text() flattenar hela dicten, så
        # en rå sha256-hash och tidsstämpel hamnade bokstavligen i SOURCE DATA.
        # Ren brus för modellen, och gör outputen mindre förutsägbar.
        ai_record = {k: v for k, v in row.items() if k not in _INTERNAL_FIELDS}
        result = format_record(ai_record, source_type, cfg)

        # SUBSTANSKRAV, del 2: has_substance() ovan skyddar bara mot tunn
        # KÄLLDATA innan AI-anropet. Men även med gott källunderlag kan
        # format_record() falla tillbaka (guardrails avvisar båda försöken --
        # icke-deterministiskt, händer ibland även på bra data). källtyper utan
        # egen TEMPLATERS-mall (meeting/event/alert) får då bara titeln
        # upprepad som body via _fallback() -- exakt den innehållslösa
        # publiceringen SUBSTANSKRAV ska förhindra. Hoppa över och låt en
        # framtida körning försöka igen (lägg INTE till i known_slugs).
        if result.generated_by == "template_fallback" and source_type not in TEMPLATERS:
            thin += 1
            continue

        title = build_title(table, row)
        source_url = build_source_url(table, row)
        snapshot_id = row.get("snapshot_id")
        occurs_at = build_occurs_at(table, row)

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, source_url,
                     snapshot_id, generated_by, verified, published_at, occurs_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (town_id, slug) DO NOTHING
                """,
                (town_id, title, slug, result.text, source_type, source_url,
                 snapshot_id, result.generated_by, result.verified,
                 datetime.now(timezone.utc), occurs_at),
            )
        known_slugs.add(slug)
        published += 1
    return published, skipped, thin, stale, remaining


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", nargs="*", help="begränsa till dessa tabeller")
    ap.add_argument(
        "--max-new-per-table", type=int, default=None,
        help=f"tak per tabell och körning (default {DEFAULT_MAX_NEW_PER_RUN}, "
             "eller ai.max_new_per_run_per_table i configen om satt)",
    )
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    max_new = (
        args.max_new_per_table
        if args.max_new_per_table is not None
        else cfg.get("ai", {}).get("max_new_per_run_per_table", DEFAULT_MAX_NEW_PER_RUN)
    )

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    with psycopg.connect(database_url) as conn:
        known = existing_slugs(conn, town_id)
        print(f"{len(known)} stories finns redan för {town_id}\n")

        tot_pub = tot_skip = tot_thin = tot_stale = tot_remaining = 0
        for table in SOURCES:
            if args.only and table not in args.only:
                continue
            pub, skip, thin, stale, remaining = publish_table(conn, cfg, table, known, max_new=max_new)
            extra = f", {thin} för tunna (ej publicerade)" if thin else ""
            extra += f", {stale} inaktuella (ej publicerade)" if stale else ""
            print(f"  {table:20} -> {pub} nya, {skip} redan publicerade{extra}")
            if remaining:
                # tydlig signal att detta är en STOR BACKFYLLNING som fortsätter
                # över flera körningar, inte att pipelinen hängt sig -- se
                # DEFAULT_MAX_NEW_PER_RUN.
                print(f"    (tak {max_new} nådd: {remaining} kvar, fortsätter nästa körning)")
            tot_pub += pub
            tot_skip += skip
            tot_thin += thin
            tot_stale += stale
            tot_remaining += remaining
        conn.commit()

    print(f"\nTotalt: {tot_pub} nya stories, {tot_skip} hoppade, "
          f"{tot_thin} för tunna, {tot_stale} inaktuella"
          + (f", {tot_remaining} kvar till nästa körning" if tot_remaining else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
