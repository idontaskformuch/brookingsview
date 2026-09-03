"""Phase 0 check 4: intra-record consistency.

"Venue, address and phone in the output all belong to the same facility
record." -- Recurring-traffic layer handoff.

Different failure mode from ai_pipeline/guardrails.py's existing fact-check:
that one asks "does this address/phone appear SOMEWHERE in the source,"
which already passes if the record's raw agenda packet mentions two
different venues' contact details (a genuinely common shape -- e.g. a
meeting notice naming the meeting room AND a separate accessibility-
accommodations phone line for a different office). This check asks the
narrower, source-internal question: when the output states an address or
phone number, does it belong to the SAME named place the output also names
-- not a different real place that merely also appears somewhere in the same
source record.

Deterministic, source-record-only (no DB/facilities lookup -- the entry
point's contract is text + source_records + cfg, nothing live). When a
source record only ever describes one place, there is nothing to cross-check
and this always passes -- the risk only exists once a record contains two or
more distinct named places.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ai_pipeline.venue_registry import normalize_venue

_NAME_KEYS = ("venue", "location", "room_name", "name")
_ADDRESS_KEYS = ("address", "street_address", "room_address")
_PHONE_KEYS = ("phone", "phone_number", "contact_phone")

_PHONE_RE = re.compile(r"\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")


@dataclass
class CheckResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


def _first(d: dict, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = d.get(k)
        if v:
            return str(v)
    return None


def _extract_entity(d: dict) -> dict | None:
    """One {name, address, phone} entity from a flat dict, or None if it
    names no place at all."""
    if not isinstance(d, dict):
        return None
    name = _first(d, _NAME_KEYS)
    address = _first(d, _ADDRESS_KEYS)
    phone = _first(d, _PHONE_KEYS)
    if not name:
        return None
    return {"name": name, "address": address, "phone": phone}


_MAX_WALK_DEPTH = 3


def extract_entities(source_records: list[dict] | dict | None) -> list[dict]:
    """Every distinct named place mentioned across the given record(s) --
    walks into ANY nested dict up to a few levels deep (not a fixed set of
    key names): a scraped record's place details show up under whatever key
    the source structure happens to use (AgendaLink's meetings.raw_data->room,
    see ai_pipeline/publish.py's KNOWN_VENUE_MATCHING_GAPS follow-up; a
    separate accessibility-contact block under its own key; etc). Best-effort,
    deterministic key matching -- same philosophy as ai_pipeline/
    venue_registry.py, not an NLP entity extractor. Depth-limited so an
    unrelated deeply-nested JSON blob can't turn this into an unbounded scan."""
    if not source_records:
        return []
    records = source_records if isinstance(source_records, list) else [source_records]

    entities: list[dict] = []
    seen_norms: set[str] = set()

    def _add(d: dict) -> None:
        entity = _extract_entity(d)
        if entity is None:
            return
        norm = normalize_venue(entity["name"])
        if norm is None or norm in seen_norms:
            return
        seen_norms.add(norm)
        entities.append(entity)

    def _walk(d: dict, depth: int) -> None:
        _add(d)
        if depth >= _MAX_WALK_DEPTH:
            return
        for v in d.values():
            if isinstance(v, dict):
                _walk(v, depth + 1)

    for record in records:
        if isinstance(record, dict):
            _walk(record, depth=0)

    return entities


def check_record_consistency(
    text: str, meta: dict | None, source_records: list[dict] | dict | None, cfg: dict,
) -> CheckResult:
    entities = extract_entities(source_records)
    if len(entities) < 2:
        return CheckResult(passed=True)  # nothing to cross-check a single place against

    haystack = text if meta is None else f"{text} {' '.join(str(v) for v in meta.values() if v)}"

    # Which entity's NAME is actually stated in the output, if any.
    named_entity = next(
        (e for e in entities if re.search(r"\b" + re.escape(e["name"]) + r"\b", haystack, re.IGNORECASE)),
        None,
    )

    violations: list[str] = []

    phone_match = _PHONE_RE.search(haystack)
    if phone_match:
        stated_phone = phone_match.group()
        stated_digits = re.sub(r"\D", "", stated_phone)
        owner = next(
            (e for e in entities if e.get("phone") and re.sub(r"\D", "", e["phone"]) == stated_digits),
            None,
        )
        if owner is not None and named_entity is not None and owner is not named_entity:
            violations.append(
                f"phone {stated_phone!r} belongs to {owner['name']!r} in the source, "
                f"but the output names {named_entity['name']!r}"
            )

    for entity in entities:
        address = entity.get("address")
        if not address or address not in haystack:
            continue
        if named_entity is not None and entity is not named_entity:
            violations.append(
                f"address {address!r} belongs to {entity['name']!r} in the source, "
                f"but the output names {named_entity['name']!r}"
            )

    return CheckResult(passed=len(violations) == 0, violations=violations)
