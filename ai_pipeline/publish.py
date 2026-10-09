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
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
import requests
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ai_pipeline import guardrails
from ai_pipeline.format_prompt import format_record, TEMPLATERS
from ai_pipeline.venue_registry import load_registry, queue_for_review, resolve_venue
from db.db import content_hash

# A record discarded this many consecutive scheduled runs (both AI attempts
# rejected, no TEMPLATERS fallback for meeting/event/alert -- see the
# SUBSTANSKRAV comment below) stops being retried at all. Without this, a
# structurally-stuck record burns 2 real API calls every 6-hour run
# indefinitely -- found live via api_usage.reject_reason (NEEDS-HUMAN-
# REVIEW.md #77/#78), not a hypothetical.
MAX_CONSECUTIVE_DISCARDS = 3

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


def fmt_dt(value, with_time: bool = False, tz: ZoneInfo | None = None) -> str | None:
    """Formatera datum läsbart. Tar datetime ELLER sträng.

    `tz`, om angett, lokaliserar HELA instanten -- både datum- och
    klockslagsdelen -- INNAN den skrivs ut. meeting_date (ren kalenderdag,
    midnatt UTC, inget tillförlitligt klockslag) ska ALDRIG skickas hit med
    ett tz -- build_title() använder sin egen _meeting_date_title_part() för
    det, aldrig fmt_dt(), exakt för att undvika att tidszonskonvertera ett
    datum som inte har en riktig klocka bakom sig (se den funktionens egen
    kommentar). Riktiga tidsstämplar (events/alerts) ska alltid skicka in
    ett `tz` när with_time=True -- och FÅR DÅ en korrekt lokal kalenderdag,
    inte bara en korrekt klocka.

    Events correctness Phase 1-fix (2026-10-08): date_part lästes tidigare
    av dt.day/.year/.strftime() rakt på det UTC-medvetna datetime-objektet
    ÄVEN när ett tz angavs -- bara _fmt_hour_min() konverterade. Ett sent
    kvällsevent som passerar UTC-midnatt (23:30 Central = 04:30 UTC NÄSTA
    dag) skrevs då ut som t.ex. "Fri, Oct 2, 2026 at 11:30 PM" i stället för
    "Thu, Oct 1, 2026 at 11:30 PM" -- rätt klockslag, fel datum, i BÅDE
    group_recurring_events()'s series_dates-lista och i
    _localize_datetime_fields()'s underlag till AI-prompten, så en felaktig
    dag kunde skrivas rakt in i publicerad artikeltext, inte bara visas fel
    på en listningssida. Bekräftat: de två enda ställena som skickar in ett
    tz (grep "fmt_dt(" i den här filen) är båda riktiga tidsstämplar, aldrig
    meeting_date, så detta är säkert att fixa utan att röra det fallet.
    """
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
    local_dt = dt.astimezone(tz) if tz is not None else dt
    date_part = f"{local_dt.strftime('%a, %b')} {local_dt.day}, {local_dt.year}"
    return f"{date_part} at {_fmt_hour_min(dt, tz)}" if with_time else date_part


def fmt_time(value, tz: ZoneInfo | None = None) -> str | None:
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
    return _fmt_hour_min(dt, tz)


def _fmt_hour_min(dt: datetime, tz: ZoneInfo | None = None) -> str:
    # FAS 2-FIX (augusti 2026): läste tidigare dt.hour rakt av på ett UTC-
    # medvetet datetime-objekt utan NÅGON konvertering -- ett kvällsevent som
    # passerar UTC-midnatt (t.ex. 19:30 Central = 00:30 UTC) skrevs ut som
    # "12:30 AM" i publicerad text. Konvertera till ortens egen tidszon
    # FÖRST, om en angetts.
    if tz is not None:
        dt = dt.astimezone(tz)
    hour12 = dt.hour % 12 or 12
    return f"{hour12}:{dt.strftime('%M %p')}"


def has_substance(table: str, row: dict) -> bool:
    """Är raden värd en egen publicerad story?

    Hellre ingen story än en innehållslös. Tunt innehåll skadar både läsaren och
    sidkvaliteten (jfr. AdSense 'low value content').
    """
    if table == "meetings":
        raw = row.get("raw_data") or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = {}
        agenda = (raw.get("agenda_text") or "").strip()
        return len(agenda) >= _MIN_AGENDA_CHARS
    if table == "events" and not row.get("is_recurring_series"):
        # FAS 2: ett event utan beskrivning är fortfarande publicerbart OM
        # det har både plats och tid -- en kort, ärlig text går att skriva
        # av det (samma generella AI-väg som allt annat, ingen särskild
        # kod). Bara ett rent "bara en titel"-event (varken beskrivning,
        # plats eller tid) är för tunt för en egen sida -- 113/1035
        # Moreno Valley-event saknade beskrivning vid revisionen, men de
        # allra flesta hade plats+tid och behöver alltså inte fångas här.
        raw = row.get("raw_data") or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = {}
        description = (raw.get("description") or "").strip()
        if description:
            return True
        return bool(row.get("venue")) and bool(row.get("starts_at"))
    return True


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


def slug_date(value, cfg: dict | None = None) -> str | None:
    """"YYYY-MM-DD" ur meeting_date, för SEO Fas 5's dateradade meeting-
    slugs (se NEEDS-HUMAN-REVIEW.md, "SEO Fas 5"). Samma "aldrig
    tidszonskonvertera ett rent kalenderdatum"-regel som fmt_dt() ovan --
    meeting_date är midnatt UTC utan tillförlitligt klockslag för
    Legistar-orter, så datumdelen läses ut direkt ur den råa datetime/
    strängen, aldrig via en tz-konvertering som skulle kunna flytta datumet
    en dag.

    FIXAT 2026-10-01 (samma rotorsak som _meeting_date_title_part()): för
    eSCRIBE/AgendaLink-orter ÄR meeting_date en riktig, tidszonsmedveten
    instans, så den råa UTC-läsningen gav en slug med fel datum (samma
    "Wed Oct 14" för ett i verkligheten Tue Oct 13-möte som titel-buggen).
    cfg (om given) avgör via samma data_sources.city_meetings.
    meetings_have_time-flagga om datumet ska lokaliseras först. Gäller bara
    FRAMTIDA/nya slugs -- redan publicerade rader behåller sin existerande
    slug för alltid (known_slugs-kollen i publish_table() körs INNAN detta
    någonsin anropas för en rad, så en redan befintlig rad når aldrig hit),
    per detta projekts etablerade "ändra aldrig en redan indexerad URL utan
    en riktig redirect"-princip."""
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
    meetings_have_time = (cfg or {}).get("data_sources", {}).get("city_meetings", {}).get("meetings_have_time", False)
    if meetings_have_time:
        tzname = (cfg or {}).get("timezone")
        if tzname:
            dt = dt.astimezone(ZoneInfo(tzname))
    return dt.strftime("%Y-%m-%d")


def _meeting_date_title_part(value, cfg: dict | None) -> str | None:
    """Date portion of a meeting story's title. Deliberately NOT fmt_dt():
    that function's date component is intentionally never tz-converted
    (see its own docstring and test_fmt_dt_date_part_never_shifts_with_tz),
    correct for Legistar towns (meeting_date is a bare calendar date) but
    wrong for eSCRIBE/AgendaLink towns, where meeting_date is a real,
    tz-aware instant -- confirmed live 2026-10-01: a Broomfield meeting
    title read "City Council Regular Meeting — Wed, Oct 14, 2026" for a
    meeting actually on Tuesday evening Denver time, because the title was
    built from the raw UTC calendar date instead of the local one (the
    exact bug already fixed on the site-display side, see db.ts's
    formatMeetingDate()). Mirrors that same town-aware distinction here,
    keyed off the same configs/<town>.json flag
    (data_sources.city_meetings.meetings_have_time) the TS side's
    siteConfig.meetingsHaveTime mirrors by hand."""
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
    meetings_have_time = (cfg or {}).get("data_sources", {}).get("city_meetings", {}).get("meetings_have_time", False)
    if meetings_have_time:
        tzname = (cfg or {}).get("timezone")
        if tzname:
            dt = dt.astimezone(ZoneInfo(tzname))
    return f"{dt.strftime('%a, %b')} {dt.day}, {dt.year}"


_QUORUM_NOTICE_RE = re.compile(r"notice of quorum", re.IGNORECASE)
_NO_OFFICIAL_BUSINESS_RE = re.compile(r"no official city business", re.IGNORECASE)
_QUORUM_EVENT_RE = re.compile(
    r"may be present (?:for|at|to)\s+(?:the )?(.+?)(?:\s+(?:to be held\s+)?(?:on\s+)?"
    r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)",
    re.IGNORECASE,
)


def is_quorum_notice_only(raw_data: dict) -> bool:
    """A Legistar "Notice of Quorum" posting (South Dakota open-meetings-law
    requirement, SDCL 1-25-1.1) announces that enough members of a body
    MIGHT attend some unrelated public event (a ribbon-cutting, a parade, a
    BBQ) to technically constitute a quorum -- explicitly "no official city
    business will be acted upon." Confirmed live 2026-10-01: 24 of
    Brookings' published meeting stories (City Council, Park & Recreation
    Advisory Board, Historic Preservation Commission) were actually one of
    these notices, not a real meeting, but still titled "{body} — {date}"
    like any other meeting -- e.g. "City Council — Thu, Oct 1, 2026" for
    what was really a solar farm ribbon-cutting ceremony.

    Requires BOTH phrases, not just "quorum" alone: a real meeting's own
    agenda routinely includes a "determination of a quorum" procedural
    step (confirmed live: Brookings County Outdoor Adventure Center
    Advisory Board, a genuine meeting) without being a notice-only
    posting -- that phrasing never co-occurred with "no official city
    business" in any of the real rows checked, so requiring both avoids
    misclassifying a real meeting."""
    agenda_text = raw_data.get("agenda_text") or ""
    return bool(_QUORUM_NOTICE_RE.search(agenda_text) and _NO_OFFICIAL_BUSINESS_RE.search(agenda_text))


def extract_quorum_event(agenda_text: str) -> str | None:
    """The actual event a quorum notice is about (e.g. "Brookings Solar
    Ribbon Cutting Ceremony"), for the "Notice: possible quorum — {event}"
    title. Verified against all 24 real notices found live 2026-10-01 --
    the phrasing varies ("may be present for/at/to the ...", "to be held
    on {weekday}" or "{weekday}" directly), so this matches up to the
    first weekday name rather than a single fixed phrase."""
    match = _QUORUM_EVENT_RE.search(agenda_text)
    return match.group(1).strip() if match else None


def build_title(table: str, row: dict, cfg: dict | None = None) -> str:
    if table == "meetings":
        raw = row.get("raw_data") or {}
        if isinstance(raw, str):
            raw = json.loads(raw)
        if is_quorum_notice_only(raw):
            event = extract_quorum_event(raw.get("agenda_text") or "")
            if event:
                return f"Notice: possible quorum — {event}"
        body = row.get("body") or "Meeting"
        when = _meeting_date_title_part(row.get("meeting_date"), cfg)
        return f"{body} — {when}" if when else str(body)
    if table == "events":
        base, _ = strip_slot(row.get("title") or "Event")
        return base
    return "Update"


def _is_sandbox_url(url: str | None) -> bool:
    """AgendaLink's own API returns `agendaUrl` values on sandbox.agendalink.app,
    not a confirmed production host (see agendalink_v1.py's module docstring
    and site/src/lib/db.ts's isSandboxUrl() -- same rule, kept in sync on
    both sides since this value is written here and read/rendered there).
    Never publish a sandbox link as a story's citable source_url; None here
    falls back to siteConfig.sourceBlurb on the render side."""
    if not url:
        return False
    host = urlparse(url).hostname or ""
    return host.startswith("sandbox.")


def build_source_url(table: str, row: dict) -> str | None:
    if table == "meetings":
        agenda_url = row.get("agenda_url")
        return None if _is_sandbox_url(agenda_url) else agenda_url
    if table == "events":
        return row.get("url")
    return None


def _venue_eligible(table: str, source_type: str) -> bool:
    """Whether this row's own `venue` field is a resolvable physical venue
    at all. Alerts and events share the `events` table (see this module's
    own point 3 above), but an NWS alert's "venue" is really areaDesc -- a
    county list (e.g. "Lincoln; Lyon; Murray; Cottonwood; Pipestone;
    Brookings") or, for some alert products, a product-category phrase
    ("Hazardous Weather Alerts") rather than a place at all (see
    nws_alerts.py's own parse()). An alert covers an area, it doesn't
    happen AT a building, so it never gets a venue_raw -- same spirit as
    _is_bare_state_code() in scrapers/event_sources.py, just scoped by row
    type instead of string content."""
    return table == "events" and source_type != "alert"


def group_event_slots(rows: list[dict], tz: ZoneInfo) -> list[dict]:
    """Kollapsa flera tidsluckor av samma event samma dag till en post.

    Grupperingsnyckel: (bastitel, datum, källa). Olika DATUM förblir separata
    stories -- samma escape room i juni och i september är två händelser.

    FAS 2-FIX: `day` togs tidigare fram med `starts.date()` rakt på det
    UTC-medvetna datetime-objektet, INNAN konvertering till ortens tidszon --
    ett sent kvällsevent (t.ex. 23:00 Pacific = 06:00 UTC nästa dag) grupperades
    då under fel kalenderdag. Konvertera till `tz` FÖRST, precis som
    _fmt_hour_min nedan gör för klockslaget.
    """
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for row in rows:
        base, _ = strip_slot(row.get("title") or "")
        starts = row.get("starts_at")
        day = starts.astimezone(tz).date().isoformat() if isinstance(starts, datetime) else str(starts)[:10]
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
            times = [t for t in (fmt_time(m.get("starts_at"), tz) for m in members) if t]
            base_row["slot_times"] = times
            base_row["slot_count"] = len(members)
            base_row["title"], _ = strip_slot(base_row.get("title") or "")
        merged.append(base_row)
    return merged


# FAS 2: samma "scaled content"-princip som slot-gruppering ovan, fast för
# ett STÖRRE mönster -- ett återkommande program ("MAIN LIBRARY: Toddler
# Time") publicerades tidigare som EN story PER instans (upp mot 50 nästan
# identiska sidor för samma program över 90 dagar). Ett program som
# upprepas minst så här många gånger slås ihop till EN kanonisk serie-story
# (programmet, schemat, återkommande platser) i stället för en sida per
# datum. Ett engångsevent som råkar dela titel med något annat berörs inte
# (färre förekomster än så lämnas orörda av group_event_slots ovan).
_MIN_RECURRING_OCCURRENCES = 3
# Hur många kommande datum som listas i seriens egen story-text.
_MAX_SERIES_DATES_SHOWN = 8


def group_recurring_events(rows: list[dict], tz: ZoneInfo) -> list[dict]:
    """Kollapsa ett återkommande programs många nästan identiska instanser
    till EN kanonisk serie-rad. Körs EFTER group_event_slots (som bara
    slår ihop tidsluckor SAMMA DAG) -- den här grupperar över HELA
    tidsfönstret, oavsett datum.
    """
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for row in rows:
        base, _ = strip_slot(row.get("title") or "")
        key = (base.lower(), row.get("source"))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    merged: list[dict] = []
    for key in order:
        members = groups[key]
        if len(members) < _MIN_RECURRING_OCCURRENCES:
            merged.extend(members)
            continue

        members = sorted(members, key=lambda r: (r.get("starts_at") or datetime.max, r["id"]))
        base_row = dict(members[0])
        # Stabil serie-slug: hash på (källa, bastitel) -- INTE en specifik
        # instans-id, som skulle driva iväg sluggen så fort just den äldsta
        # instansen rullar ur fönstret eller tas bort ur events-tabellen.
        series_hash = content_hash("event-series", key[1] or "", key[0])[:16]
        base_row["id"] = f"series-{series_hash}"
        base_row["title"], _ = strip_slot(base_row.get("title") or "")
        base_row["is_recurring_series"] = True
        base_row["series_dates"] = [
            fmt_dt(m.get("starts_at"), with_time=True, tz=tz) for m in members[:_MAX_SERIES_DATES_SHOWN]
        ]
        base_row["series_count"] = len(members)
        merged.append(base_row)
    return merged


def existing_slugs(conn, town_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug FROM stories WHERE town_id = %s", (town_id,))
        return {r[0] for r in cur.fetchall()}


def existing_meeting_ids(conn, town_id: str) -> set[int]:
    """AdSense remediation Phase B1: the real dedup key for meeting-sourced
    stories is the underlying meetings.id, not the computed slug string --
    see db/migrations/034_stories_meeting_id.sql's own comment for the bug
    this fixes (a slug-format change, e.g. the SEO Fas 5 dated-slug
    rollout, made a row that was already published look "new" again to a
    slug-string-only check, producing a second row for the same meeting).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT meeting_id FROM stories WHERE town_id = %s AND source_type = 'meeting' AND meeting_id IS NOT NULL",
            (town_id,),
        )
        return {r[0] for r in cur.fetchall()}


def already_has_a_story(source_type: str, row_id: int, known_meeting_ids: set[int]) -> bool:
    """AdSense remediation Phase B1: the real "has this already been
    published?" check for a meeting is its meetings.id, checked BEFORE
    computing a slug -- not the slug string a slug-format change (e.g. the
    SEO Fas 5 dated-slug rollout) could make look "new" again regardless
    of what it computes to. See db/migrations/034_stories_meeting_id.sql
    for the 77-row live bug this fixes. Only meaningful for meetings --
    every other source_type is still deduped by known_slugs alone,
    unchanged."""
    return source_type == "meeting" and row_id in known_meeting_ids


def _alert(town_id: str, msg: str) -> None:
    """Same fire-and-forget pattern as scrapers/runner.py's and scripts/
    check_deployed_content.py's own _alert() -- duplicated, not imported,
    matching this codebase's existing convention of a small per-module
    helper over a shared one (see e.g. site/server/content-slug-redirects.ts's
    own comment on the same tradeoff). ALERT_WEBHOOK is already wired into
    all three *-scrape.yml workflows' env (used by check_source_staleness.py
    in the same job), so no workflow change is needed for this to fire."""
    hook = os.environ.get("ALERT_WEBHOOK")
    full_msg = f"[{town_id}] publish.py gave up retrying a record: {msg}"
    print(f"ALERT: {full_msg}", file=sys.stderr)
    if hook:
        try:
            requests.post(hook, json={"text": full_msg}, timeout=10)
        except Exception:  # pragma: no cover
            pass


def load_given_up_records(conn, town_id: str) -> dict[tuple[str, str], str | None]:
    """(source_type, record_id) -> source_content_hash, for every record
    already at/over MAX_CONSECUTIVE_DISCARDS -- loaded once per
    publish_table() call (same pattern as existing_slugs()/
    existing_meeting_ids()), so a record publish.py has already given up on
    is skipped BEFORE format_record() is ever called again, not just logged
    as skipped after spending on it anyway.

    The hash is returned (not just the key) so the caller can detect "the
    underlying source record changed since we gave up" and un-give-up it --
    see publish_table()'s own use of this and record_discard()'s reset-on-
    hash-change logic below."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_type, record_id, source_content_hash FROM publish_discard_streak "
            "WHERE town_id = %s AND consecutive_runs >= %s",
            (town_id, MAX_CONSECUTIVE_DISCARDS),
        )
        return {(r[0], r[1]): r[2] for r in cur.fetchall()}


def record_discard(conn, town_id: str, source_type: str, record_id: str,
                    reject_reason: str | None, source_content_hash: str | None) -> int:
    """UPSERTs this record's consecutive-discard streak, returns the new
    count. Runs on the SAME `conn` as every other write in publish_table() --
    so --dry-run's rollback (see main()) undoes this bookkeeping exactly
    like it undoes a real INSERT INTO stories, instead of a dry/test run
    silently polluting the real retry-cap count.

    Reset-on-change (db/migrations/049_...): if the record's current
    source_content_hash differs from what's stored (the underlying scraped
    data changed since the last discard -- a corrected agenda, a re-scrape
    that picked up new detail), this is effectively new data, not a repeat
    failure of the same input -- the streak resets to 1 instead of
    incrementing, `first_discarded_at` resets to now() along with it (it
    means "start of the CURRENT streak," not "first ever seen"). `IS
    DISTINCT FROM` (NULL-safe) rather than `!=` since source_content_hash
    can genuinely be NULL (a record with no content_hash of its own, or the
    pre-049 rows that predate this column).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO publish_discard_streak
                (town_id, source_type, record_id, consecutive_runs, last_discarded_at,
                 last_reject_reason, source_content_hash)
            VALUES (%s, %s, %s, 1, now(), %s, %s)
            ON CONFLICT (town_id, source_type, record_id) DO UPDATE SET
                consecutive_runs = CASE
                    WHEN publish_discard_streak.source_content_hash IS DISTINCT FROM EXCLUDED.source_content_hash
                        THEN 1
                    ELSE publish_discard_streak.consecutive_runs + 1
                END,
                first_discarded_at = CASE
                    WHEN publish_discard_streak.source_content_hash IS DISTINCT FROM EXCLUDED.source_content_hash
                        THEN now()
                    ELSE publish_discard_streak.first_discarded_at
                END,
                last_discarded_at = now(),
                last_reject_reason = EXCLUDED.last_reject_reason,
                source_content_hash = EXCLUDED.source_content_hash
            RETURNING consecutive_runs
            """,
            (town_id, source_type, record_id, reject_reason, source_content_hash),
        )
        return cur.fetchone()[0]


def clear_discard_streak(conn, town_id: str, source_type: str, record_id: str) -> None:
    """Deletes this record's streak row, if any -- called on a successful
    publish. A record that eventually succeeds wasn't permanently stuck, so
    nothing more to track (see module docstring at the top of this file's
    migration, db/migrations/048_publish_discard_streak.sql, for why this
    table only ever holds CURRENTLY struggling records)."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM publish_discard_streak WHERE town_id = %s AND source_type = %s AND record_id = %s",
            (town_id, source_type, record_id),
        )


def _recent_openings(conn, town_id: str, source_type: str, limit: int = 10) -> list[str]:
    """Opening shapes (guardrails.classify_opening()) of the most recently
    published same-source_type/town stories -- the proxy for "what's
    rendered on one page" the tone_v2 diversity check needs (see
    guardrails.opening_diversity_ok()'s own docstring for why an exact
    page-level check isn't possible at generation time). Only meaningful
    for tone_v2; harmless, unused cost otherwise."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT body FROM stories WHERE town_id = %s AND source_type = %s "
            "ORDER BY published_at DESC LIMIT %s",
            (town_id, source_type, limit),
        )
        return [guardrails.classify_opening(row[0]) for row in cur.fetchall()]


def _localize_datetime_fields(record: dict, tz: ZoneInfo) -> dict:
    """Ersätt rå UTC-datetime-fält (starts_at/ends_at -- INTE meeting_date,
    se fmt_dt-docstringen för varför) med lokaliserade textsträngar innan
    posten flattenas till AI-promptens SOURCE DATA.

    FAS 2-FIX: guardrails.source_to_text() gör str(v) på VARJE fält i
    ai_record, inklusive rå datetime-objekt -- modellen fick alltså se t.ex.
    "starts_at: 2026-09-09 06:00:00+00:00" med ingen lokaliserad tid att
    utgå från, och skrev ibland av UTC-tiden rakt in i publicerad text
    ("starting 11 p.m. UTC..."). Ge modellen bara en korrekt, redan
    lokaliserad sträng att arbeta med, aldrig ett rått tidsstämpel-objekt.
    """
    out = dict(record)
    for field in ("starts_at", "ends_at"):
        value = out.get(field)
        if isinstance(value, datetime):
            out[field] = fmt_dt(value, with_time=True, tz=tz)
    return out


def publish_table(
    conn, cfg: dict, table: str, known_slugs: set[str], max_new: int = DEFAULT_MAX_NEW_PER_RUN,
    known_meeting_ids: set[int] | None = None, verbose: bool = False,
) -> tuple[int, int, int, int, int, int]:
    known_meeting_ids = known_meeting_ids if known_meeting_ids is not None else set()
    town_id = cfg["town_id"]
    given_up = load_given_up_records(conn, town_id)
    tz = ZoneInfo(cfg.get("timezone", "America/Chicago"))
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT * FROM {table} WHERE town_id = %s ORDER BY id", (town_id,))
        rows = [dict(r) for r in cur.fetchall()]

    if table == "events":
        rows = group_event_slots(rows, tz)
        rows = group_recurring_events(rows, tz)

    # Event JSON-LD venue resolution (see ai_pipeline/venue_registry.py):
    # loaded once per publish_table() call, not per row -- facilities don't
    # change mid-run. Only relevant for "events"; harmless no-op cost for
    # "meetings" (empty dict, resolve_venue() always misses).
    venue_registry = load_registry(conn, town_id) if table == "events" else {}

    # Summary Tone Prompts (see NEEDS-HUMAN-REVIEW.md): the opening-diversity
    # check needs a "what's already out there" baseline per source_type,
    # fetched once and then updated in-memory as this run publishes more --
    # see _recent_openings() and format_prompt.py's format_record(). Only
    # meaningful under cfg["ai"]["tone_v2"]; a harmless unused dict otherwise.
    tone_v2 = bool(cfg.get("ai", {}).get("tone_v2"))
    recent_openings_by_type: dict[str, list[str]] = (
        {st: _recent_openings(conn, town_id, st) for st in ("meeting", "event", "alert")}
        if tone_v2 else {}
    )

    published = skipped = thin = stale = remaining = abandoned = 0
    for row in rows:
        if not has_substance(table, row):
            thin += 1
            continue

        source_type = resolve_source_type(table, row)
        record_id = str(row["id"])

        # varningar har ett bäst-före-datum en agenda/eventbeskrivning inte har
        # -- se is_current(). Kollas innan slug/AI så en inaktuell varning
        # aldrig ens hinner formateras.
        if not is_current(source_type, row):
            stale += 1
            continue

        if already_has_a_story(source_type, row["id"], known_meeting_ids):
            skipped += 1
            continue

        # Retry cap (NEEDS-HUMAN-REVIEW.md #77/#78, MAX_CONSECUTIVE_DISCARDS):
        # a record already given up on in a PRIOR run -- checked before
        # known_slugs/the AI call, so it costs nothing further, not just
        # "logged as skipped after spending on it anyway." Reset path
        # (db/migrations/049_...): if the record's CURRENT source data no
        # longer matches the hash we gave up against, treat it as new --
        # clear the streak and fall through to a normal attempt instead of
        # skipping, rather than leaving it permanently excluded against
        # stale content it may no longer even have.
        if (source_type, record_id) in given_up:
            if given_up[(source_type, record_id)] != row.get("content_hash"):
                clear_discard_streak(conn, town_id, source_type, record_id)
            else:
                abandoned += 1
                continue

        # SEO Fas 5: meetings get a dated slug going forward
        # ("meeting-2026-08-25-10703" instead of "meeting-10703") -- a
        # more descriptive, indexable URL, per NEEDS-HUMAN-REVIEW.md.
        # meeting_followup keeps its own existing "meeting-followup-{id}"
        # scheme (ai_pipeline/meeting_followups.py) -- untouched here.
        date_part = slug_date(row.get("meeting_date"), cfg) if source_type == "meeting" else None
        slug = f"{source_type}-{date_part}-{row['id']}" if date_part else f"{source_type}-{row['id']}"
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
        ai_record = _localize_datetime_fields(ai_record, tz)
        result = format_record(
            ai_record, source_type, cfg,
            recent_openings=recent_openings_by_type.get(source_type),
        )
        if result.meta is not None:
            # Keep this run's own baseline current so the 5th event
            # published in one run is judged against the 4 that just
            # preceded it, not only against stories from earlier runs.
            recent_openings_by_type.setdefault(source_type, []).append(
                guardrails.classify_opening(result.text)
            )

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
            reject_reason = "; ".join(result.violations) if result.violations else None
            streak = record_discard(conn, town_id, source_type, record_id, reject_reason,
                                    row.get("content_hash"))
            if streak >= MAX_CONSECUTIVE_DISCARDS:
                # Give up for good: excluded from the rest of THIS run too
                # (not just the next one) via the same known_slugs/
                # known_meeting_ids sets already_has_a_story()/the slug
                # check above read.
                known_slugs.add(slug)
                if source_type == "meeting":
                    known_meeting_ids.add(row["id"])
                abandoned += 1
                _alert(town_id, f"{source_type} #{record_id} discarded {streak} consecutive runs -- "
                                f"giving up. last_reject_reason: {reject_reason}")
                if verbose:
                    print(f"    ABANDON  {slug}  ({streak} consecutive discards -- never retrying again)")
            elif verbose:
                print(f"    DISCARD  {slug}  (attempt {streak}/{MAX_CONSECUTIVE_DISCARDS}, "
                      "retried next run)")
            continue

        # A record that just succeeded wasn't permanently stuck -- clear any
        # streak a PRIOR run's discard(s) left behind, so a record that
        # struggled for 1-2 runs and then passed doesn't carry a stale
        # streak toward some future, unrelated failure.
        clear_discard_streak(conn, town_id, source_type, record_id)

        title = build_title(table, row, cfg)
        source_url = build_source_url(table, row)
        snapshot_id = row.get("snapshot_id")
        occurs_at = build_occurs_at(table, row)
        venue_raw = row.get("venue") if _venue_eligible(table, source_type) else None
        # Brookings' library calendar (LibCal, source="library") never
        # populates a LOCATION field at all -- confirmed live: 0 of 88 raw
        # library-source event rows have `venue` set, vs. 36 of 37 for
        # "chamber" (see NEEDS-HUMAN-REVIEW.md, "Brookings Venue Registry").
        # Every event on the LIBRARY'S OWN calendar genuinely happens at the
        # library building -- a structural fact, not a guess, since
        # Brookings has exactly one public library (unlike Moreno Valley,
        # which also has a "library" source but multiple real branches --
        # see that source's own MAIN LIBRARY / MV MALL LIBRARY venue
        # prefixes, where this same default would be WRONG). Scoped to
        # town_id specifically, never a blanket "any library source" rule.
        if table == "events" and not venue_raw and row.get("source") == "library" and town_id == "brookings_sd":
            venue_raw = "Brookings Public Library"
        is_recurring_series = bool(row.get("is_recurring_series")) if table == "events" else False
        # A grouped/series row's ends_at belongs to members[0] alone (same
        # caveat as its starts_at/occurs_at) -- fine for a single event, not
        # meaningful for a series, so left NULL there rather than implying
        # one occurrence's end time covers the whole program.
        ends_at = row.get("ends_at") if (table == "events" and not is_recurring_series) else None

        # Resolve once, at publish time, purely to decide whether to queue
        # for human review -- the RESOLUTION ITSELF is re-done at every site
        # build against the live registry (site/src/lib/db.ts), never
        # cached on the row, so a later alias addition heals this event
        # automatically without touching `stories` again. See
        # ai_pipeline/venue_registry.py's module docstring.
        if table == "events" and venue_raw and not is_recurring_series:
            if resolve_venue(venue_registry, venue_raw) is None:
                queue_for_review(conn, town_id, venue_raw)

        meeting_id = row["id"] if source_type == "meeting" else None

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, source_url,
                     snapshot_id, generated_by, verified, published_at, occurs_at,
                     venue_raw, is_recurring_series, ends_at, meta, meeting_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (town_id, slug) DO NOTHING
                """,
                (town_id, title, slug, result.text, source_type, source_url,
                 snapshot_id, result.generated_by, result.verified,
                 datetime.now(timezone.utc), occurs_at,
                 venue_raw, is_recurring_series, ends_at,
                 Jsonb(result.meta) if result.meta is not None else None, meeting_id),
            )
        known_slugs.add(slug)
        if meeting_id is not None:
            known_meeting_ids.add(meeting_id)
        published += 1
        if verbose:
            occurs_label = occurs_at.date().isoformat() if occurs_at else "(no date)"
            print(f"    PUBLISH  {slug}  occurs_at={occurs_label}  generated_by={result.generated_by}")
    return published, skipped, thin, stale, remaining, abandoned


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", nargs="*", help="begränsa till dessa tabeller")
    ap.add_argument(
        "--max-new-per-table", type=int, default=None,
        help=f"tak per tabell och körning (default {DEFAULT_MAX_NEW_PER_RUN}, "
             "eller ai.max_new_per_run_per_table i configen om satt)",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="kör på riktigt (riktiga sök-/AI-anrop, samma kostnad som en publicering) men "
             "rulla tillbaka transaktionen i stället för att committa -- skriv per-rad vad som "
             "skulle publicerats/kastats (slug, occurs_at, generated_by)",
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
        known_meetings = existing_meeting_ids(conn, town_id)
        print(f"{len(known)} stories finns redan för {town_id}\n")

        tot_pub = tot_skip = tot_thin = tot_stale = tot_remaining = tot_abandoned = 0
        for table in SOURCES:
            if args.only and table not in args.only:
                continue
            pub, skip, thin, stale, remaining, abandoned = publish_table(
                conn, cfg, table, known, max_new=max_new, known_meeting_ids=known_meetings,
                verbose=args.dry_run,
            )
            extra = f", {thin} för tunna (ej publicerade)" if thin else ""
            extra += f", {stale} inaktuella (ej publicerade)" if stale else ""
            extra += f", {abandoned} uppgivna efter {MAX_CONSECUTIVE_DISCARDS} försök" if abandoned else ""
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
            tot_abandoned += abandoned
        if args.dry_run:
            conn.rollback()
        else:
            conn.commit()

    print(f"\nTotalt: {tot_pub} nya stories, {tot_skip} hoppade, "
          f"{tot_thin} för tunna, {tot_stale} inaktuella"
          + (f", {tot_abandoned} uppgivna" if tot_abandoned else "")
          + (f", {tot_remaining} kvar till nästa körning" if tot_remaining else ""))
    if args.dry_run:
        print("(dry-run -- transaktionen rullades tillbaka, INGET skrevs till stories)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
