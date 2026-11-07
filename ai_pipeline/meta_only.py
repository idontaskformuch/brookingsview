"""Meta-only extraction for events and meetings (owner 2026-11-07).

The site prints no model-written prose (site/src/lib/ai-text.ts), so the model's one remaining job here is to copy a few reference
facts out of the source. It returns `{"meta": {...}}` and nothing else: no summary, no tone/voice rules, no second attempt. Every
value is then checked against the source text in code, and a value that cannot be found there is DROPPED (the page shows the
fact row only when it is true). The row's body is a template line built from the source title and the kept values, generated_by
is "template". Alerts need no meta at all (nothing on the site reads it), so they never reach the model.

Gated by cfg["ai"]["meta_only"]; format_record() falls back to the tone_v2 path when the flag is off.
"""
from __future__ import annotations

import json
import re
import unicodedata


# What the model is asked for, per source type. Alerts are absent on purpose: no model call.
META_KEYS: dict[str, tuple[str, ...]] = {
    "event": ("venue", "address", "when", "recurrence", "audience", "cost", "registration"),
    "meeting": ("venue", "address", "registration"),
}
META_ONLY_TYPES = frozenset(META_KEYS) | {"alert"}
MAX_VALUE_CHARS = 200

_KEY_HELP = {
    "venue": "name of the place where it happens, as written in the source",
    "address": "street address, as written in the source",
    "when": "dates or times beyond the start time, only if the source lists several; as written",
    "recurrence": 'only "Weekly", "Daily", "Monthly" or "Every N weeks", only if the source says it repeats',
    "audience": 'one of "All ages", "Adults", "Teens", "Kids and families", "Public", only if the source says who it is for',
    "cost": '"Free" if the source says it is free; otherwise the price(s) with the currency symbol, as written ("$10", "£8 / £5")',
    "registration": "sign-up or ticket URL, or the sign-up instruction, as written in the source",
}


def build_system_prompt(source_type: str) -> str:
    keys = META_KEYS[source_type]
    lines = "\n".join(f"- {k}: {_KEY_HELP[k]}" for k in keys)
    return (
        f"Copy reference facts for a local {source_type} out of SOURCE DATA. Use only what the source states; never infer, "
        "complete or reword. Never include a private person's name.\n"
        'Return ONLY a JSON object, no fences: {"meta": {...}} with these keys; leave out any key the source does not '
        f"state, never emit an empty string.\n{lines}"
    )


def parse_meta_response(raw: str) -> dict | None:
    """The `meta` object, or None when the reply is not `{"meta": {...}}` JSON (the caller then treats it as a failed call)."""
    from ai_pipeline.format_prompt import strip_json_fence  # lazy: format_prompt imports this module
    try:
        obj = json.loads(strip_json_fence(raw))
    except ValueError:
        return None
    meta = obj.get("meta") if isinstance(obj, dict) else None
    return meta if isinstance(meta, dict) else None


# --- validation against the source ------------------------------------------------------------------------------------

_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")
_DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_ABBREV = {**{m[:3]: m for m in _MONTHS}, "sept": "september", **{d[:3]: d for d in _DAYS}, "tues": "tuesday", "thur": "thursday", "thurs": "thursday"}
_FILLER = frozenset("a an the at in on and of to from through until with for by or".split())


def _tokens(text: str) -> list[str]:
    s = unicodedata.normalize("NFKC", str(text)).casefold()
    s = re.sub(r"\b([ap])\.m\.?", r"\1m", s)      # "p.m." == "pm"
    s = re.sub(r"(\d):00\b", r"\1", s)            # "9:00" == "9"
    s = re.sub(r"(\d)(?:st|nd|rd|th)\b", r"\1", s)  # "25th" == "25"
    toks = re.findall(r"\d+|[^\W\d_]+", s)        # "7pm" -> "7", "pm"
    return [_ABBREV.get(t, t) for t in toks]


def _in_source(value: str, source_tokens: set[str], source_raw: str) -> bool:
    """Every content word and number of `value` occurs in the source (order and punctuation free); URLs must occur verbatim."""
    if re.match(r"https?://", value, re.I):
        return value.rstrip(".,;)").casefold() in source_raw.casefold()
    needed = [t for t in _tokens(value) if t not in _FILLER]
    return bool(needed) and all(t in source_tokens for t in needed)


_AMOUNT = r"[$£€]\s?\d[\d,]*(?:\.\d{2})?"
_COST_AMOUNTS_RE = re.compile(rf"^{_AMOUNT}(?:\s*(?:,|/|-|–|to|and|or)\s*{_AMOUNT})*$", re.I)
_FREE_CUE_RE = re.compile(r"\bfree\b|no (?:charge|cost|fee|admission fee)|complimentary", re.I)

# audience: the fixed vocabulary, each with the words that must appear in the source for the label to be true.
AUDIENCE_CUES: dict[str, re.Pattern] = {
    "All ages": re.compile(r"all[- ]ages|any age|everyone|open to all|all welcome", re.I),
    "Adults": re.compile(r"\badults?\b|\b(?:18|21)\s?\+|\b(?:18|21) (?:and|or) (?:over|older|up)|over (?:18|21)", re.I),
    "Teens": re.compile(r"\bteens?\b|teenagers?|young adults?|\byouth\b|\bages? 1[2-9]\b", re.I),
    "Kids and families": re.compile(r"\bkids?\b|children|\bchild\b|toddlers?|famil(?:y|ies)|storytime|preschool|babies", re.I),
    "Public": re.compile(r"\bpublic\b|open to all|all welcome|community", re.I),
}
_AUDIENCE_BY_LOWER = {a.casefold(): a for a in AUDIENCE_CUES}

# recurrence: only the cadences the site reads (time.ts seriesKicker, event-day-view recurrenceKind), each with its source cue.
RECURRENCE_CUES: dict[str, tuple[re.Pattern, re.Pattern]] = {
    "weekly": (re.compile(r"^(?:weekly|every\s+week)$", re.I), re.compile(r"weekly|every\s+week|each week|freq=weekly", re.I)),
    "daily": (re.compile(r"^(?:daily|every\s+day)$", re.I), re.compile(r"daily|every\s+day|each day|freq=daily", re.I)),
    "monthly": (re.compile(r"^monthly$", re.I), re.compile(r"monthly|every\s+month|each month|freq=monthly", re.I)),
    "fortnightly": (re.compile(r"^every\s+\d+\s+weeks?$", re.I), re.compile(r"every\s+\d+\s+weeks?|biweekly|fortnight|interval=\d", re.I)),
}


def validate_meta(meta: dict, source_type: str, source_text: str) -> tuple[dict, list[tuple[str, object, str]]]:
    """(kept, dropped). `dropped` lists (key, value, reason) for every value that failed; kept values are trimmed strings."""
    allowed = META_KEYS.get(source_type, ())
    src_tokens = set(_tokens(source_text))
    kept: dict[str, str] = {}
    dropped: list[tuple[str, object, str]] = []
    for key, value in meta.items():
        if key not in allowed:
            dropped.append((key, value, "key not requested"))
            continue
        if not isinstance(value, str) or not value.strip():
            if value not in (None, ""):
                dropped.append((key, value, "not a string"))
            continue
        v = value.strip()
        reason = None
        if len(v) > MAX_VALUE_CHARS:
            reason = "too long"
        elif key == "cost":
            if re.fullmatch(r"free\.?", v, re.I):
                v = "Free"
                reason = None if _FREE_CUE_RE.search(source_text) else "free not stated in source"
            elif not _COST_AMOUNTS_RE.match(v):
                reason = "not 'Free' or an amount"
            elif not all(t in src_tokens for t in _tokens(v)):
                reason = "amount not in source"
        elif key == "audience":
            label = _AUDIENCE_BY_LOWER.get(v.casefold().rstrip("."))
            if label is None:
                reason = "not in the audience vocabulary"
            elif not AUDIENCE_CUES[label].search(source_text):
                reason = "audience not stated in source"
            else:
                v = label
        elif key == "recurrence":
            hit = next((cues for shape, cues in RECURRENCE_CUES.values() if shape.match(v)), None)
            if hit is None:
                reason = "cadence the site does not read"
            elif not hit.search(source_text):
                reason = "cadence not stated in source"
        elif not _in_source(v, src_tokens, source_text):
            reason = "not found in source"
        if reason:
            dropped.append((key, value, reason))
        else:
            kept[key] = v
    return kept, dropped


# --- body ---------------------------------------------------------------------------------------------------------------

def template_body(title: str, source_type: str, meta: dict | None) -> str:
    """The row's stored text: the source title plus the kept place, nothing the source did not give."""
    meta = meta or {}
    title = (title or "").strip().rstrip(".")
    if source_type == "event":
        place = (meta.get("venue") or "").rstrip(".")
        return f"{title} at {place}." if place and place.casefold() not in title.casefold() else f"{title}."
    if source_type == "meeting":
        place = (meta.get("address") or meta.get("venue") or "").rstrip(".")
        return f"{title}. Location: {place}." if place else f"{title}."
    return f"{title}."
