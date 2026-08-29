"""Story Threads -- see Claude Code handoff "Story Threads". Implemented as
an EXTENSION of the existing City Hall Project Pages system
(ai_pipeline/project_registry.py, ai_pipeline/project_updates.py), not a
parallel table pair -- investigation before this module was written found
`projects`/`project_updates` already do almost exactly what "Story Threads"
describes for meetings (a hand-curated entity accumulating a real, sourced
timeline, matched by exact case number). What this module adds:

  1. Candidate detection for BOTH meetings and traffic (traffic is new;
     project_registry.py has only ever covered meetings).
  2. AI-assisted matching (with cited confidence) for a candidate that
     doesn't match any project by exact case number -- project_registry.py's
     own matching stays exactly as strict/deterministic as it already is;
     this is a SECOND, looser pass that only runs when the first one finds
     nothing, and only ever queues a result for human review, never
     auto-creates or auto-appends on its own.
  3. Synthesis (per-entry) and rolling_summary (per-project) generation,
     under the same guardrail philosophy as every other digest in this
     pipeline -- see check_no_project_outcome_prediction in guardrails.py.

Candidate detection is deliberately more permissive than matching: a wrong
CANDIDATE just means a human rejects it in the review queue (see
scripts/review_project_candidates.py); a wrong MATCH means content is
misattributed to the wrong live, public project page. Get the second one
conservative before trusting the first one to be automatic (this module's
own founding instruction) -- there is no "auto-create" path here at all,
by design; Phase 2 (auto-creation without human review) is explicitly
deferred, not built here.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from ai_pipeline import guardrails
from ai_pipeline.format_prompt import (
    GenerationUnavailable, pricing_for, resolve_model, safe_create, strip_json_fence,
    _record_spend, _spent_this_month,
)

try:
    import anthropic
except ImportError:  # pragma: no cover -- same optional-dependency pattern as every other digest
    anthropic = None


# --- candidate detection: meetings -------------------------------------------

# Explicit item-type language a rezoning/development agenda item almost
# always carries, in the absence of a real structured "item type" field on
# the source data (confirmed live: eSCRIBE/Legistar/AgendaLink agenda items
# only expose title/description/motion text, no separate category). A
# keyword match here is the practical stand-in for "the source's own
# categorization," per the handoff's own phrasing.
THREAD_WORTHY_KEYWORDS = (
    "rezone", "rezoning", "zone change", "zoning amendment",
    "conditional use permit", "variance", "subdivision", "plot plan",
    "site plan", "general plan amendment", "specific plan", "annexation",
    "capital improvement", "development agreement", "development review",
)


def is_candidate_agenda_item(title: str, description: str = "") -> bool:
    """Lightweight signal check, run BEFORE spending any AI call (see this
    module's own docstring and the handoff's "candidate detection" section).
    Deliberately keyword-only, never a machine-learned classifier -- a false
    positive here costs nothing but one line in a human's review queue; a
    false negative just means an ongoing story stays uncollected a little
    longer, not a wrong page."""
    haystack = f"{title} {description}".casefold()
    return any(kw in haystack for kw in THREAD_WORTHY_KEYWORDS)


# --- candidate detection: traffic --------------------------------------------
#
# DEFERRED -- not wired into any scheduled run (see ai_pipeline/
# traffic_project_updates.py's own module docstring). Real-data dry-run
# against Moreno Valley (2026-08-29) found 44 "candidates," almost all
# routine multi-day freeway maintenance (guardrail work, bridge work,
# utility work) on state highways passing through the area -- real,
# bounded, sourced, but not the kind of narratively-followable local story
# ("a road widening, a rezoning fight") this feature is for, and nothing
# in this dataset showed what a genuine story-worthy traffic item looks
# like to calibrate a stricter heuristic against. Fix the bug below
# regardless (real bug independent of the deferral), but do not point any
# workflow at traffic_project_updates.py until there's a real example to
# tune against -- same "flag rather than guess" call as permits being
# explicitly out of scope in the original handoff.

# 'lane_closure' (a Caltrans-planned closure/construction entry) vs.
# 'chp_incident' (a CHP-logged incident -- almost always a one-off wreck,
# never a multi-week project) -- see scrapers/parsers/traffic_v1.py's own
# _classify_severity(). Confirmed live: this data source has no explicit
# duration/phase field, so incident_type + severity are the closest real
# proxies available, not an invented signal.
_CANDIDATE_TRAFFIC_TYPES = {"lane_closure"}
_CANDIDATE_TRAFFIC_SEVERITIES = {"closure", "planned"}
# An entry has to have been open a few days before it's worth threading --
# same reasoning as the meeting side: a same-day blip isn't an "ongoing
# story" yet, however it's classified.
MIN_TRAFFIC_CANDIDATE_AGE_DAYS = 3
# The scrape cycle runs every 6 hours (see scrape.yml) -- a day of slack
# comfortably covers a missed run without treating a genuinely-resolved
# incident (no longer appearing in any recent scrape) as still ongoing.
_RECENTLY_SEEN_WINDOW = timedelta(days=1)


def is_candidate_traffic_incident(incident: dict, now: datetime | None = None) -> bool:
    """now is compared against last_seen_at (how recently this incident was
    STILL appearing in a scrape), not created_at -- a row this source never
    deletes just sits in the table looking "old" by wall-clock time long
    after it actually resolved. Real bug caught live: a same-day accident
    closure (created_at and last_seen_at under an hour apart) was still
    flagged as a candidate days later, because created_at alone was being
    compared to *now*. Duration is last_seen_at - created_at (how long it
    was actually observed open), and it must still be recent to count as
    currently ongoing."""
    if incident.get("incident_type") not in _CANDIDATE_TRAFFIC_TYPES:
        return False
    if incident.get("severity") not in _CANDIDATE_TRAFFIC_SEVERITIES:
        return False
    created_at = incident.get("created_at")
    last_seen_at = incident.get("last_seen_at")
    if not created_at or not last_seen_at:
        return False
    now = now or datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)

    still_active = (now - last_seen_at) <= _RECENTLY_SEEN_WINDOW
    observed_duration = last_seen_at - created_at
    return still_active and observed_duration >= timedelta(days=MIN_TRAFFIC_CANDIDATE_AGE_DAYS)


# --- "stalled" / "resolved" display state ------------------------------------

# Suggested in the handoff as a starting point, not hardcoded logic buried
# in a query -- a named constant, same convention as
# HOME_SALES_INDEXABLE_MONTHS (site/src/lib/home-sales.ts).
STALLED_AFTER_DAYS = 90


def thread_activity_state(updated_at: datetime, resolved_at: datetime | None, now: datetime | None = None) -> str:
    """'active' | 'stalled' | 'resolved' -- computed fresh from updated_at,
    never a stored enum (see db/migrations/032_project_threads.sql's own
    comment: the same staleness risk the home-sales age-out work was built
    to avoid). resolved_at is the one genuinely persisted fact; active vs.
    stalled is purely a function of elapsed time."""
    if resolved_at is not None:
        return "resolved"
    now = now or datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if (now - updated_at) >= timedelta(days=STALLED_AFTER_DAYS):
        return "stalled"
    return "active"


# --- AI-assisted matching -----------------------------------------------------

# Below this, a match is never trusted even if the model returned a non-null
# project id -- "set a confidence threshold. Below it: do not auto-append"
# per the handoff, enforced in code here, not left to prompt-following alone.
MATCH_CONFIDENCE_THRESHOLD = 0.75


def build_match_prompt(candidate_text: str, open_projects: list[dict]) -> str:
    projects_block = "\n".join(
        f'- id={p["id"]}: "{p["title"]}" -- {p["description"]}' for p in open_projects
    )
    return f"""You are checking whether a new local civic item is about one of a list of
already-tracked ongoing local stories, or is unrelated to all of them.

CURRENTLY TRACKED, STILL-OPEN STORIES:
{projects_block}

NEW ITEM:
{candidate_text}

Decide whether the NEW ITEM is clearly a further development in ONE of the
tracked stories above, based on genuinely overlapping, SPECIFIC detail --
the same street name, parcel, project name, or applicant, not a vague
topical similarity ("both are about zoning" is not enough on its own).
If you are not confident, say so plainly rather than guessing -- a missed
match costs nothing (the item just gets reviewed as a possible new story
instead); a wrong match publishes on someone else's project page.

Respond with ONLY a JSON object, no other text, no markdown fence:
{{"match_project_id": <id from the list above, or null if none/unsure>,
  "confidence": <a number from 0.0 to 1.0>,
  "reasoning": "<cite the specific overlapping detail that supports this, or say specifically why nothing matches>"}}
"""


def _parse_match_response(raw: str) -> dict | None:
    text = strip_json_fence(raw)
    try:
        obj = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    if not isinstance(obj.get("reasoning"), str) or not obj["reasoning"].strip():
        return None
    confidence = obj.get("confidence")
    if not isinstance(confidence, (int, float)):
        return None
    match_id = obj.get("match_project_id")
    if match_id is not None and not isinstance(match_id, int):
        return None
    return {"match_project_id": match_id, "confidence": float(confidence), "reasoning": obj["reasoning"].strip()}


def ai_match_candidate(candidate_text: str, open_projects: list[dict], cfg: dict, client=None) -> dict:
    """Returns {"match_project_id": int|None, "confidence": float, "reasoning": str}.
    match_project_id is forced to None below MATCH_CONFIDENCE_THRESHOLD or on
    ANY failure (no open projects, budget exhausted, API error, unparseable
    response) -- every failure mode fails toward "treat as an unmatched
    candidate for the new-thread queue," never toward a guessed append."""
    if not open_projects:
        return {"match_project_id": None, "confidence": 0.0, "reasoning": "no open projects to match against"}

    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return {"match_project_id": None, "confidence": 0.0, "reasoning": "AI budget exhausted this month"}

    if client is None:
        if anthropic is None:
            return {"match_project_id": None, "confidence": 0.0, "reasoning": "anthropic client unavailable"}
        client = anthropic.Anthropic()

    model = resolve_model("project_thread_match", cfg)
    price_in, price_out = pricing_for(model)
    prompt = build_match_prompt(candidate_text, open_projects)

    try:
        msg = safe_create(client, model=model, max_tokens=400,
                           messages=[{"role": "user", "content": prompt}])
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    except GenerationUnavailable as exc:
        return {"match_project_id": None, "confidence": 0.0, "reasoning": f"AI call failed: {exc}"}

    parsed = _parse_match_response(raw)
    if parsed is None:
        return {"match_project_id": None, "confidence": 0.0, "reasoning": "unparseable AI response"}

    if parsed["confidence"] < MATCH_CONFIDENCE_THRESHOLD:
        parsed["match_project_id"] = None
    return parsed


# --- synthesis (per-entry) and rolling_summary (per-project) generation -----

MIN_SYNTHESIS_WORDS = 8


def _guardrails_pass(text: str, source_text: str, cfg: dict) -> guardrails.GuardrailResult:
    fact = guardrails.validate(text, source_text, cfg)
    prediction = guardrails.check_no_project_outcome_prediction(text)
    violations = fact.violations + prediction.violations
    return guardrails.GuardrailResult(passed=fact.passed and prediction.passed, violations=violations)


def synthesis_template_fallback(item_title: str) -> str:
    """No AI call, no guardrail risk -- a plain restatement of the source's
    own title is always safe, just not synthesis. Same safe-degraded-mode
    philosophy as every other digest's template_fallback()."""
    return f"New item: {item_title}."


def generate_synthesis(item_title: str, item_text: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    """Returns (text, generated_by, verified) -- same shape as every other
    generate() in this pipeline. item_text is the full source text (agenda
    item title+description, or a traffic incident's title+description) fed
    as SOURCE DATA for the fact-in-source guardrail."""
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return synthesis_template_fallback(item_title), "template_fallback", True

    if client is None:
        if anthropic is None:
            return synthesis_template_fallback(item_title), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model("project_thread_synthesis", cfg)
    price_in, price_out = pricing_for(model)
    system = (
        "You write a single short sentence (one line, no more than 30 words) "
        "describing what changed in an ongoing local story, for a news site "
        "timeline entry. Use ONLY facts present in the SOURCE DATA. Never "
        "predict a vote outcome, permit decision, or completion timeline "
        "beyond what the source explicitly states. This is a factual "
        "update line, not a restated headline -- say what's new or what it "
        "means in practice, not just the item's own title verbatim."
    )

    def call(extra: str = "") -> str:
        msg = safe_create(client, model=model, max_tokens=150, system=system + extra,
                           messages=[{"role": "user", "content": f"SOURCE DATA:\n{item_text}"}])
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()

    try:
        text = call()
        result = _guardrails_pass(text, item_text, cfg)
        if not result.passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or predicted an outcome/timeline the source doesn't "
                        "state. Rewrite using ONLY facts explicitly present in the "
                        "SOURCE DATA, describing the current situation only.")
            result = _guardrails_pass(text, item_text, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return synthesis_template_fallback(item_title), "template_fallback", True

    if result.passed and len(text.split()) >= MIN_SYNTHESIS_WORDS:
        return text, f"ai:{model}", True

    print(f"  guardrail avvisade syntesraden ({result.violations[:3]}) -- faller tillbaka på mall")
    return synthesis_template_fallback(item_title), "template_fallback", True


def rolling_summary_template_fallback(project_title: str) -> str:
    return f"See the timeline below for the latest updates on {project_title}."


def generate_rolling_summary(project_title: str, recent_entries_text: str, cfg: dict, client=None) -> tuple[str, str, bool]:
    """recent_entries_text: the project's own timeline (most recent
    entries' synthesis lines, newest first) as SOURCE DATA -- the summary
    must be grounded in the thread's OWN recorded history, never outside
    knowledge about the project."""
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return rolling_summary_template_fallback(project_title), "template_fallback", True

    if client is None:
        if anthropic is None:
            return rolling_summary_template_fallback(project_title), "template_fallback", True
        client = anthropic.Anthropic()

    model = resolve_model("project_thread_summary", cfg)
    price_in, price_out = pricing_for(model)
    system = (
        f'You write a short "where things stand" summary (2-4 sentences) for '
        f'an ongoing local story called "{project_title}", for the top of its '
        "page on a local news site. Use ONLY facts present in the SOURCE DATA "
        "(the story's own recorded timeline, newest first). Never predict a "
        "vote outcome, permit decision, or completion date beyond what the "
        "source explicitly states -- describe the current situation only."
    )

    def call(extra: str = "") -> str:
        msg = safe_create(client, model=model, max_tokens=250, system=system + extra,
                           messages=[{"role": "user", "content": f"SOURCE DATA (timeline, newest first):\n{recent_entries_text}"}])
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()

    try:
        text = call()
        result = _guardrails_pass(text, recent_entries_text, cfg)
        if not result.passed:
            text = call("\n\nYour previous attempt included details not found in the "
                        "source, or predicted an outcome/timeline the source doesn't "
                        "state. Rewrite using ONLY facts explicitly present in the "
                        "SOURCE DATA, describing the current situation only.")
            result = _guardrails_pass(text, recent_entries_text, cfg)
    except GenerationUnavailable as exc:
        print(f"  AI-anrop misslyckades ({exc}) -- faller tillbaka på mall")
        return rolling_summary_template_fallback(project_title), "template_fallback", True

    if result.passed:
        return text, f"ai:{model}", True

    print(f"  guardrail avvisade rolling summary ({result.violations[:3]}) -- faller tillbaka på mall")
    return rolling_summary_template_fallback(project_title), "template_fallback", True


# --- DB-aware orchestration helpers -------------------------------------
# (conn as first arg, matching this codebase's convention -- see
# ai_pipeline/project_updates.py's own helpers)

def load_open_projects_for_matching(conn, town_id: str) -> list[dict]:
    """Separate from project_registry.load_projects() (id/slug/title/
    case_numbers only, used for the exact-match path) -- AI matching needs
    `description` for real comparison text and must exclude resolved
    projects, which that function doesn't filter."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, description FROM projects WHERE town_id = %s AND resolved_at IS NULL",
            (town_id,),
        )
        return [{"id": r[0], "title": r[1], "description": r[2]} for r in cur.fetchall()]


def queue_new_candidate(conn, town_id: str, source_type: str, *, meeting_id: int | None = None,
                         traffic_incident_id: int | None = None, candidate_title: str,
                         candidate_summary: str, match_reasoning: str, confidence: float) -> None:
    """Never auto-creates a project -- see scripts/review_project_candidates.py
    for the human-in-the-loop step that turns a queued row into a real one."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO project_new_candidate_queue
                (town_id, source_type, meeting_id, traffic_incident_id,
                 candidate_title, candidate_summary, match_reasoning, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (town_id, source_type, meeting_id, traffic_incident_id,
             candidate_title, candidate_summary, match_reasoning, confidence),
        )


def regenerate_rolling_summary(conn, project_id: int, cfg: dict, client=None) -> None:
    """Called after any new entry lands on a project (meeting or traffic) --
    "regenerated each time a new entry lands" per the handoff. Grounded in
    the project's OWN recorded timeline, most recent entries first."""
    with conn.cursor(row_factory=None) as cur:
        cur.execute("SELECT title FROM projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
        if row is None:
            return
        project_title = row[0]

        cur.execute(
            """
            SELECT COALESCE(synthesis, agenda_title, body, 'update') AS line, created_at
              FROM project_updates
             WHERE project_id = %s
             ORDER BY created_at DESC
             LIMIT 8
            """,
            (project_id,),
        )
        entries = cur.fetchall()

    if not entries:
        return
    timeline_text = "\n".join(f"- {line}" for line, _created in entries)

    summary, _generated_by, _verified = generate_rolling_summary(project_title, timeline_text, cfg, client=client)

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE projects SET rolling_summary = %s, updated_at = now() WHERE id = %s",
            (summary, project_id),
        )
