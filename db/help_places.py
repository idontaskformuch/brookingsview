"""/help/ data model on places (owner 2026-11-27; spec .claude/specs/help-resources.md, decisions in help-resources-phase0-report.md).

One place for the rules every /help/ writer and reader shares: which categories exist and which are on, what a row must carry
before it is written (nothing guessed: the street address and every requirement line must stand verbatim on the source page),
the town rule (TOWN_NAMES below: the source gives the town as locality or says it serves the town), publish / queue / reject, and when a row is visible (verified, from an official or operator source, checked within MAX_AGE_DAYS,
inside its season). The site mirrors HELP_CATEGORIES (site/src/lib/db.ts, site/astro.config.mjs; tests/test_help_places.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

HELP_CATEGORIES = ("food_pantry", "meal_program", "warm_space", "assistance_program", "free_clinic")
# Step 1: food and winter help. assistance_program comes in step 2 (link cards), free_clinic is out of scope (spec Phase 3).
ENABLED_CATEGORIES = frozenset({"food_pantry", "meal_program", "warm_space"})
# Decision 2: a warm space on an existing place is 'warm_space' in places.services + a place_roles row with its own dates.
HELP_ROLES = ("warm_space",)
SOURCE_KINDS = ("official", "operator", "other")
PUBLISHED_KINDS = frozenset({"official", "operator"})
STATUSES = ("verified", "changed", "stale", "gone")
AUDIENCE_TAGS = frozenset({"families", "seniors", "students", "everyone"})
MAX_AGE_DAYS = 45   # spec help.max_age_days; the same 45 as site-config placeStaleness.hoursDays
MIN_ENTRIES = 6     # spec help.min_entries; owner decision 1: stays 6, a town below it has no /help/ page
MAX_NOTE_CHARS = 160

# Town rule (owner 2026-11-27): a place is on a town's /help/ only when its source page EITHER gives the town as the place's
# locality OR says in so many words that it serves the town. The parser names the phrase (HelpEntry.town_evidence); it must stand
# verbatim on the source page and pass one of the two tests:
#   locality  the town name followed by the state or a UK postcode, at most one word between ("Broomfield, CO 80020",
#             "Glasgow G51 1QH", "Glasgow Bridgeton G40 1QH")
#   serves    the town name together with a serving word ("The pantries below serve residents across Moreno Valley.")
# A page that names only another town (Good Shepherd: "Northglenn, CO 80234") or no town at all (Harvest Table) is rejected, and the
# site's own domain name or the operator's name ("Feeding Brookings") is never evidence. Which "serves" sentence a parser uses is
# chosen per source and shown to the owner in the dry run; the test only keeps a phrase that names neither from passing.
TOWN_NAMES = {"brookings_sd": "Brookings", "broomfield_co": "Broomfield", "moreno_valley_ca": "Moreno Valley", "glasgow": "Glasgow"}
_LOCALITY_TAIL = {"brookings_sd": r"SD\b", "broomfield_co": r"CO\b", "moreno_valley_ca": r"CA\b",
                  "glasgow": r"G\d{1,2}\s?\d[A-Z]{2}\b"}
_SERVES = re.compile(r"\b(serv\w*|support\w*|residents?|famil(?:y|ies)|neighbou?rs)\b", re.I)


@dataclass(frozen=True)
class HelpEntry:
    town_id: str
    slug: str
    name: str
    category: str
    source_url: str
    source_kind: str
    street_address: str | None = None
    address: str | None = None  # the full display line ("908 Hope Drive, Brookings, SD 57006"), built by the parser from town config
    postal_code: str | None = None
    phone: str | None = None
    website: str | None = None
    requirements_note: str | None = None
    area_name: str | None = None
    audience_tags: tuple[str, ...] = field(default_factory=tuple)
    valid_from: date | None = None
    valid_to: date | None = None
    schedule_rule: str | None = None
    town_evidence: str | None = None  # the town rule's phrase (above); checked, not stored


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().casefold()


def _on_page(value: str, page: str) -> bool:
    """Verbatim on the page as whole words ("908 Hope Dr" is not on a page that says "908 Hope Drive")."""
    needle = _norm(value)
    return bool(needle) and re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", _norm(page)) is not None


def town_kind(town_id: str, evidence: str | None) -> str | None:
    """'locality' | 'serves' | None: which half of the town rule the phrase meets (None = neither)."""
    name = TOWN_NAMES.get(town_id)
    if not name or not evidence:
        return None
    text = re.sub(r"\s+", " ", evidence)
    if re.search(rf"\b{re.escape(name)}\b,?\s+(?:[A-Za-z]+\s+)?{_LOCALITY_TAIL[town_id]}", text):
        return "locality"
    if re.search(rf"\b{re.escape(name)}\b", text) and _SERVES.search(text):
        return "serves"
    return None


def town_problem(entry: HelpEntry, page_text: str) -> str | None:
    if not entry.town_evidence:
        return f"town: the source neither gives {TOWN_NAMES.get(entry.town_id, entry.town_id)} as the locality nor says it serves it"
    if not _on_page(entry.town_evidence, page_text):
        return f"town: {entry.town_evidence!r} is not on the source page"
    if town_kind(entry.town_id, entry.town_evidence) is None:
        return f"town: {entry.town_evidence!r} is neither a {TOWN_NAMES.get(entry.town_id)} locality nor a serving statement"
    return None


def validate(entry: HelpEntry, page_text: str) -> list[str]:
    """Problems that stop a write; [] = fine. page_text is the source page's text as fetched (PoliteFetcher)."""
    problems = []
    if not entry.source_url:
        problems.append("source_url missing")
    if entry.source_kind not in SOURCE_KINDS:
        problems.append(f"source_kind {entry.source_kind!r} not one of {SOURCE_KINDS}")
    if entry.category not in ENABLED_CATEGORIES:
        problems.append(f"category {entry.category!r} is not an enabled help category")
    bad_tags = set(entry.audience_tags) - AUDIENCE_TAGS
    if bad_tags:
        problems.append(f"audience_tags {sorted(bad_tags)} not in {sorted(AUDIENCE_TAGS)}")
    if entry.street_address and not _on_page(entry.street_address, page_text):
        problems.append(f"street_address {entry.street_address!r} is not on the source page")
    if entry.postal_code and not _on_page(entry.postal_code, page_text):
        problems.append(f"postal_code {entry.postal_code!r} is not on the source page")
    if entry.requirements_note:
        if len(entry.requirements_note) > MAX_NOTE_CHARS:
            problems.append(f"requirements_note longer than {MAX_NOTE_CHARS} characters")
        for part in entry.requirements_note.split("; "):
            if not _on_page(part, page_text):
                problems.append(f"requirements_note line {part!r} is not on the source page")
    if entry.schedule_rule and not _on_page(entry.schedule_rule, page_text):
        problems.append(f"schedule_rule {entry.schedule_rule!r} is not on the source page")
    if entry.valid_from and entry.valid_to and entry.valid_from > entry.valid_to:
        problems.append("valid_from after valid_to")
    town = town_problem(entry, page_text)
    if town:
        problems.append(town)
    return problems


def publish_decision(entry: HelpEntry, page_text: str, review: str | None = None) -> tuple[str, str]:
    """('publish' | 'queue' | 'reject', why). Spec Phase 2: official/operator publish, other goes to the candidate queue.
    `review` = the parser could read the row but something on the page needs the owner first (a stale page, two seasonal
    schedules without dates, "every other Monday" without a start date): queued, never published."""
    problems = validate(entry, page_text)
    if problems:
        return "reject", "; ".join(problems)
    if entry.source_kind not in PUBLISHED_KINDS:
        return "queue", f"source_kind {entry.source_kind}"
    if review:
        return "queue", review
    return "publish", ""


def _in_season(row: dict, today: date) -> bool:
    return (row.get("valid_from") is None or row["valid_from"] <= today) and (row.get("valid_to") is None or today <= row["valid_to"])


def _fresh(row: dict, today: date, max_age_days: int) -> bool:
    checked = row.get("verified_date")
    return (row.get("verification_status") == "verified" and row.get("source_kind") in PUBLISHED_KINDS
            and checked is not None and (today - checked).days <= max_age_days)


def is_visible(row: dict, today: date, max_age_days: int = MAX_AGE_DAYS) -> bool:
    """A help place row (dict with category, source_kind, verification_status, verified_date, valid_from, valid_to)."""
    return row.get("category") in ENABLED_CATEGORIES and _fresh(row, today, max_age_days) and _in_season(row, today)


def role_active(services, role_row: dict | None, today: date, max_age_days: int = MAX_AGE_DAYS) -> bool:
    """A role (warm_space) on an existing place: in its services AND a place_roles row that is fresh and in season."""
    if role_row is None or role_row.get("role") not in (services or []):
        return False
    return _fresh(role_row, today, max_age_days) and _in_season(role_row, today)


def page_has_enough(visible_count: int, min_entries: int = MIN_ENTRIES) -> bool:
    return visible_count >= min_entries


_COLUMNS = ("name", "category", "address", "street_address", "postal_code", "phone", "website", "source_url", "source_kind",
            "verification_status", "verified_date", "requirements_note", "area_name", "audience_tags", "valid_from", "valid_to",
            "schedule_rule", "verification_method")


def _values(entry: HelpEntry, today: date) -> tuple:
    return (entry.name, entry.category, entry.address, entry.street_address, entry.postal_code, entry.phone, entry.website,
            entry.source_url, entry.source_kind, "verified", today, entry.requirements_note, entry.area_name,
            list(entry.audience_tags) or None, entry.valid_from, entry.valid_to, entry.schedule_rule, "help")


def write_entry(cur, entry: HelpEntry, today: date) -> str:
    """Insert or update one validated entry (call publish_decision first). Never touches a place outside HELP_CATEGORIES:
    a pantry in a church we already list as a venue is a separate row, not a rewrite of the venue."""
    cur.execute("SELECT id, category FROM places WHERE town_id = %s AND slug = %s", (entry.town_id, entry.slug))
    existing = cur.fetchone()
    values = _values(entry, today)
    if existing is None:
        cols = ("town_id", "slug", *_COLUMNS, "content_hash", "updated_at")
        cur.execute(f"INSERT INTO places ({', '.join(cols)}) VALUES ({', '.join(['%s'] * (len(cols) - 1))}, now())",
                    (entry.town_id, entry.slug, *values, f"help-{entry.slug}"))
        return "insert"
    place_id, category = existing
    if category not in HELP_CATEGORIES:
        raise ValueError(f"{entry.town_id}/{entry.slug} is a {category} row, not a help place: not overwritten")
    sets = ", ".join(f"{c} = %s" for c in _COLUMNS)
    cur.execute(f"UPDATE places SET {sets}, updated_at = now() WHERE id = %s", (*values, place_id))
    return "update"
