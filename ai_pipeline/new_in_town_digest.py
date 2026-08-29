"""New in Town (/new-in-town) -- search-and-summarize local business
openings/closings. See Handoff: Information Hub Tier 1, Feature B.

Same shape as ai_pipeline/workplace_watch_digest.py: Brave Search for
discovery (never scrapes Yelp/Google/Facebook directly, same ToS reasoning),
an AI extraction call turning raw snippets into structured records, and a
separate AI call for a short paraphrased weekly roundup story. This is the
only one of the three Tier-1 features with a real per-run dollar cost and
the highest factual-error risk (a wrongly-claimed closure is the kind of
mistake a real business owner notices and calls about) -- both of those
drive real design choices below, not just prose caveats:

COST: every single Brave Search call is gated by
ai_pipeline.search_budget.reserve_request() BEFORE it happens, never
after -- see that module's docstring for why a JSON state file (the
AI-spend-tracker pattern) can't enforce a cross-run monthly ceiling on an
ephemeral CI runner. Hitting the ceiling mid-run stops the run outright, not
"log and keep going."

CLOSURES: a 'closed' claim from a SINGLE source is recorded but marked
needs_review=true and is NEVER shown on the page -- see upsert_business()'s
two-source rule below. Only a second, independently-URLed source flips it
to renderable. No "or explicit official confirmation" shortcut is
implemented: deciding what counts as sufficiently official is itself a
judgment call this pipeline can't reliably automate, so when in doubt this
always resolves to needs_review=true and nothing rendered, never a guess.

Running:
    python -m ai_pipeline.new_in_town_digest --config configs/brookings_sd.json
    python -m ai_pipeline.new_in_town_digest --config configs/brookings_sd.json --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

from ai_pipeline import guardrails, search_budget, search_client
from ai_pipeline.format_prompt import (
    GenerationUnavailable, build_system_prompt, strip_json_fence, _spent_this_month, _record_spend,
    resolve_model, pricing_for, safe_create,
)

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None

ROUNDUP_SOURCE_TYPE = "new_in_town_digest"
EXTRACTION_CONTENT_TYPE = "new_in_town_extraction"
VALID_STATUSES = {"opened", "opening_soon", "closed"}
ROUNDUP_MIN_WORDS = 20
STATUS_VERB = {"opened": "opened", "opening_soon": "is opening soon", "closed": "has closed"}


# --- query building -----------------------------------------------------

def build_queries(feat: dict) -> list[str]:
    queries = [
        f"{term} {qualifier}"
        for term in feat["search_terms"]
        for qualifier in feat["location_qualifiers"]
    ]
    return queries[: feat["max_searches_per_run"]]


# --- extraction: raw search results -> structured records ---------------

def build_results_block(results: list[dict]) -> str:
    return "\n\n".join(
        f"[{i}] {r['title']}\n{r['description']}\nURL: {r['url']}"
        for i, r in enumerate(results, 1)
    )


def build_extraction_prompt(cfg: dict, results: list[dict]) -> str:
    from content._base import town_label
    return f"""You are extracting structured facts about LOCAL BUSINESS openings and
closings in {town_label(cfg)} from web search results below.

Return ONLY a JSON array (no markdown fence, no preamble). Each element:
{{"name": "...", "category": "...", "status": "opened" | "opening_soon" | "closed",
  "address": "..." or null, "source_url": "...", "source_name": "...",
  "reported_date": "YYYY-MM-DD" or null}}

HARD RULES:
- source_url MUST be copied EXACTLY (character for character) from one of
  the numbered results below. Never invent, guess, shorten, or normalize a
  URL. If you cannot cite a real URL from the results for a fact, omit that
  record entirely rather than guessing one.
- Only include businesses clearly located in {town_label(cfg)} itself -- not
  a same-named business in a different city, not a national chain's
  headquarters elsewhere, not a location in a neighboring town.
- status must be exactly one of "opened", "opening_soon", "closed" -- infer
  from the result's own language ("now open" -> opened; "coming soon" /
  "opening in [month]" -> opening_soon; "has closed" / "permanently closed"
  / "shut down" -> closed).
- If the same business appears in multiple results, emit ONE record citing
  whichever single result is most informative.
- If nothing in the results actually describes a real opening/closing,
  return an empty array: []

SEARCH RESULTS:
{build_results_block(results)}"""


def extract_records(cfg: dict, results: list[dict], client) -> list[dict]:
    if not results or client is None:
        return []
    model = resolve_model(EXTRACTION_CONTENT_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    msg = safe_create(
        client, model=model, max_tokens=1500,
        system=build_extraction_prompt(cfg, results),
        messages=[{"role": "user", "content": "Extract the records now."}],
    )
    _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    text = strip_json_fence(raw)
    try:
        records = json.loads(text)
    except ValueError:
        return []
    if not isinstance(records, list):
        return []
    return [r for r in records if isinstance(r, dict)]


def _find_result_for_url(results: list[dict], url: str | None) -> dict | None:
    if not url:
        return None
    for r in results:
        if r.get("url") == url:
            return r
    return None


def _normalize_for_location_match(s: str) -> str:
    """Strips comma/period punctuation before matching -- real search
    snippets almost always write "Brookings, SD", not "Brookings SD" the
    way a bare config string does. Without this, a completely real local
    business would be rejected as chain-store noise on punctuation alone
    (caught live by this module's own test suite)."""
    return re.sub(r"[,.]", "", s).casefold()


def validate_record(record: dict, results: list[dict], location_qualifiers: list[str]) -> tuple[bool, str]:
    """Every reject reason here is a real, previously-named risk (Handoff
    §3.3): an invented citation, a chain store leaking in from another
    metro area, or a plain malformed record. Any failure means the record
    is dropped, never rendered with a best-guess field.

    On success, mutates `record` to attach the matched result's own
    description as `_source_snippet` -- generate_roundup()'s verbatim-copy
    check (guardrails.check_no_verbatim_source_copy) needs the REAL source
    text to compare against; without this it would silently have nothing to
    check against at all."""
    if not record.get("name"):
        return False, "no name"
    if record.get("status") not in VALID_STATUSES:
        return False, f"invalid status {record.get('status')!r}"
    result = _find_result_for_url(results, record.get("source_url"))
    if result is None:
        return False, "source_url not among the real search results (possible invented citation)"
    haystack = _normalize_for_location_match(f"{result.get('title', '')} {result.get('description', '')}")
    if not any(_normalize_for_location_match(q) in haystack for q in location_qualifiers):
        return False, "no location-qualifier match in the cited result -- likely chain-store/wrong-location noise"
    record["_source_snippet"] = result.get("description", "")
    return True, ""


# --- upsert: the two-source rule for closures ----------------------------

def preview_outcome(conn, town_id: str, record: dict) -> str:
    """Read-only twin of upsert_business()'s outcome classification, for
    --dry-run: does the same SELECT, returns the same outcome strings, never
    writes. Needed so a dry run can still populate `newly_rendered` and
    actually preview the roundup story -- without this, --dry-run could
    never exercise generate_roundup()'s guardrails at all, since it would
    always skip before deciding whether any record was newly renderable."""
    name = record["name"].strip()
    status = record["status"]
    source_url = record["source_url"]

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT source_url, needs_review FROM local_businesses "
            "WHERE town_id = %s AND name = %s AND status = %s",
            (town_id, name, status),
        )
        existing = cur.fetchone()

    if existing is None:
        return "inserted_pending_review" if status == "closed" else "inserted_new"
    if status != "closed":
        return "updated_existing"
    if source_url == existing["source_url"]:
        return "duplicate_source_no_change"
    # A different URL than the one on file: whether THIS specific URL was
    # already recorded as a corroborating source would need one more query
    # (local_business_sources) to know for certain -- but needs_review's
    # current value already answers the only thing that matters for a
    # preview: is this claim already confirmed, or would a new corroborating
    # source right now be the one that confirms it.
    return "corroborated_closure" if existing["needs_review"] else "duplicate_source_no_change"


def upsert_business(conn, town_id: str, record: dict) -> str:
    """Returns one of: 'inserted_new' (opened/opening_soon, first time seen),
    'updated_existing' (opened/opening_soon, refreshed citation),
    'inserted_pending_review' (a FIRST closure claim -- not renderable yet),
    'corroborated_closure' (a SECOND, different source confirmed a pending
    closure -- now renderable), 'duplicate_source_no_change' (the same
    source re-found, not a second source).

    See module docstring for why 'closed' gets this extra step and
    'opened'/'opening_soon' don't: a false "opened" is a minor annoyance, a
    false "closed" is reputational harm to a real, named business.
    """
    name = record["name"].strip()
    status = record["status"]
    source_url = record["source_url"]
    source_name = record.get("source_name") or "unknown source"
    category = record.get("category")
    address = record.get("address")
    reported_date = record.get("reported_date")

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, source_url, needs_review FROM local_businesses "
            "WHERE town_id = %s AND name = %s AND status = %s",
            (town_id, name, status),
        )
        existing = cur.fetchone()

    if existing is None:
        needs_review = status == "closed"
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO local_businesses
                    (town_id, name, category, status, address, source_url, source_name,
                     reported_date, needs_review)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (town_id, name, category, status, address, source_url, source_name,
                 reported_date, needs_review),
            )
        conn.commit()
        return "inserted_pending_review" if needs_review else "inserted_new"

    if status != "closed":
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE local_businesses
                   SET category = %s, address = %s, source_url = %s,
                       source_name = %s, reported_date = %s
                 WHERE id = %s
                """,
                (category, address, source_url, source_name, reported_date, existing["id"]),
            )
        conn.commit()
        return "updated_existing"

    # status == 'closed': the same article re-appearing in search results
    # is not a second source -- only a genuinely different URL counts.
    if source_url == existing["source_url"]:
        return "duplicate_source_no_change"

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO local_business_sources (local_business_id, source_url, source_name, reported_date)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (local_business_id, source_url) DO NOTHING
            """,
            (existing["id"], source_url, source_name, reported_date),
        )
        newly_recorded = cur.rowcount > 0
        if newly_recorded and existing["needs_review"]:
            cur.execute("UPDATE local_businesses SET needs_review = false WHERE id = %s", (existing["id"],))
    conn.commit()
    return "corroborated_closure" if (newly_recorded and existing["needs_review"]) else "duplicate_source_no_change"


# --- weekly roundup narrative ---------------------------------------------

def build_roundup_source_text(newly_rendered: list[dict]) -> str:
    lines = ["NEWLY CONFIRMED THIS WEEK:"]
    for b in newly_rendered:
        line = f"- {b['name']} ({b.get('category') or 'business'}): {b['status']}, source: {b['source_name']}"
        if b.get("address"):
            line += f", {b['address']}"
        lines.append(line)
    return "\n".join(lines)


def build_roundup_prompt(cfg: dict) -> str:
    return build_system_prompt(cfg) + """

FORMAT OVERRIDE -- NEW IN TOWN WEEKLY ROUNDUP:
Write a short (2-4 sentence) roundup of the local business openings/closings
listed in the source data, IN YOUR OWN WORDS. Never copy a source's
wording verbatim -- paraphrase every fact.

HARD RULES SPECIFIC TO THIS FORMAT:
- Attribute every claim about a named business to its source ("according to
  [source]", "[source] reports", ...) -- never state it as bare fact.
- Do not mention any business not listed in the source data.
- If a business has closed, state that plainly, without editorializing or
  speculating about why.
- If the source data itself frames an item in context (e.g. a second/third
  location, filling a space vacant since a named prior business, a chain's
  first location in the area), include that context plainly -- it's real
  information, not editorializing. Never add context the source doesn't
  provide.

Return ONLY the paragraph. No title, no preamble."""


def roundup_template_fallback(newly_rendered: list[dict], cfg: dict) -> str:
    town = cfg["display_name"]
    lines = [f"New business activity in {town} this week:"]
    for b in newly_rendered:
        lines.append(f"- {b['name']} {STATUS_VERB[b['status']]}, according to {b['source_name']}.")
    return "\n".join(lines)


def generate_roundup(newly_rendered: list[dict], cfg: dict, client=None) -> tuple[str, str]:
    """Returns (text, generated_by). Falls back to a plain template on any
    guardrail failure -- same philosophy as workplace_watch_digest.py."""
    src = build_roundup_source_text(newly_rendered)
    fallback = roundup_template_fallback(newly_rendered, cfg)
    ai_cfg = cfg.get("ai", {})
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return fallback, "template_fallback"

    if client is None:
        if anthropic is None:
            return fallback, "template_fallback"
        client = anthropic.Anthropic()

    model = resolve_model(ROUNDUP_SOURCE_TYPE, cfg)
    price_in, price_out = pricing_for(model)
    system = build_roundup_prompt(cfg)
    business_names = [b["name"] for b in newly_rendered]
    snippets = [b.get("_source_snippet", "") for b in newly_rendered]

    def call(extra: str = "") -> str:
        msg = safe_create(
            client, model=model, max_tokens=500, system=system + extra,
            messages=[{"role": "user", "content": f"SOURCE DATA:\n{src}"}],
        )
        _record_spend(msg.usage.input_tokens * price_in + msg.usage.output_tokens * price_out)
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")

    def check(text: str) -> guardrails.GuardrailResult:
        results = [
            guardrails.validate(text, src, cfg),
            guardrails.validate_business_attribution(text, business_names),
            guardrails.check_no_verbatim_source_copy(text, snippets),
        ]
        violations = [v for r in results for v in r.violations]
        return guardrails.GuardrailResult(passed=not violations, violations=violations)

    try:
        text = call()
        result = check(text)
        if not result.passed:
            text = call("\n\nYour previous attempt included a detail not found in the source, "
                        "an unattributed claim about a named business, or wording copied too "
                        "closely from a source. Rewrite using only the SOURCE DATA, paraphrased, "
                        "every business claim attributed.")
            result = check(text)
    except GenerationUnavailable as exc:
        print(f"  AI call failed ({exc}) -- falling back to template")
        return fallback, "template_fallback"

    if result.passed and len(text.split()) >= ROUNDUP_MIN_WORDS:
        return text, f"ai:{model}"

    reason = "guardrail" if not result.passed else "too short"
    print(f"  falling back to template ({reason})")
    for v in result.violations[:5]:
        print(f"    - {v}")
    return fallback, "template_fallback"


def _isoweek_slug(d: date) -> str:
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-w{iso_week:02d}"


def _roundup_hash(newly_rendered: list[dict]) -> str:
    payload = "|".join(sorted(f"{b['name']}::{b['status']}::{b['source_url']}" for b in newly_rendered))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true",
                    help="run real search + AI calls (costs the same as publishing, and still "
                         "counts against the request ceiling -- the API cost is real either way) "
                         "but skip writing to local_businesses/stories")
    ap.add_argument("--force", action="store_true",
                    help="regenerate this week's roundup even if the set of newly-confirmed businesses is unchanged")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    town_id = cfg["town_id"]
    feat = cfg.get("features", {}).get("new_in_town", {})

    if not feat.get("enabled"):
        print(f"New in Town disabled for {town_id} -- nothing to do")
        return 0

    if not os.environ.get("BRAVE_API_KEY"):
        print("BRAVE_API_KEY missing -- skipping New in Town run entirely (not a crash)")
        return 0

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL saknas i .env")

    client = anthropic.Anthropic() if anthropic is not None else None

    with psycopg.connect(database_url) as conn:
        queries = build_queries(feat)
        all_results: list[dict] = []
        seen_urls: set[str] = set()
        queries_run = 0

        for query in queries:
            if not search_budget.reserve_request(conn, town_id, feat["monthly_request_ceiling"]):
                used = search_budget.requests_this_month(conn, town_id)
                print(f"  search request ceiling reached ({used} used this month) -- "
                      "stopping the run, not just logging past it")
                break
            queries_run += 1
            try:
                results = search_client.brave_search(query)
            except search_client.SearchUnavailable as exc:
                print(f"  search failed for {query!r} ({exc}) -- skipping this query")
                continue
            for r in results:
                if r.get("url") and r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    all_results.append(r)

        print(f"Ran {queries_run}/{len(queries)} quer{'y' if queries_run == 1 else 'ies'}, "
              f"{len(all_results)} unique result(s) collected")

        raw_records = extract_records(cfg, all_results, client) if all_results else []

        newly_rendered: list[dict] = []
        rejected = pending_review = 0
        for record in raw_records:
            ok, reason = validate_record(record, all_results, feat["location_qualifiers"])
            if not ok:
                rejected += 1
                print(f"  rejected {record.get('name', '?')!r}: {reason}")
                continue

            if args.dry_run:
                outcome = preview_outcome(conn, town_id, record)
                print(f"  (dry-run) would {outcome}: {record['name']} ({record['status']})")
                if outcome in ("inserted_new", "corroborated_closure"):
                    newly_rendered.append(record)
                continue

            outcome = upsert_business(conn, town_id, record)
            if outcome in ("inserted_new", "corroborated_closure"):
                newly_rendered.append(record)
                print(f"  {outcome}: {record['name']} ({record['status']})")
            elif outcome == "inserted_pending_review":
                pending_review += 1
                print(f"  needs_review=true, not rendered yet: {record['name']} (closed, single source)")

        print(f"Summary: {len(newly_rendered)} newly renderable, {pending_review} pending a second "
              f"source, {rejected} rejected")

        if not newly_rendered or args.dry_run:
            if args.dry_run and newly_rendered:
                text, generated_by = generate_roundup(newly_rendered, cfg, client)
                print("\n" + "=" * 70)
                print(f"(dry-run) ROUNDUP [{generated_by}]:\n{text}")
                print("=" * 70)
            return 0

        slug = f"new-in-town-{_isoweek_slug(date.today())}"
        new_hash = _roundup_hash(newly_rendered)
        with conn.cursor() as cur:
            cur.execute("SELECT content_hash FROM stories WHERE town_id=%s AND slug=%s", (town_id, slug))
            row = cur.fetchone()
        if row and row[0] == new_hash and not args.force:
            print(f"  {slug}: unchanged since last run -- skipping (no AI call)")
            return 0

        text, generated_by = generate_roundup(newly_rendered, cfg, client)
        title = f"{cfg['display_name']}: new businesses this week"
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stories
                    (town_id, title, slug, body, source_type, occurs_at,
                     generated_by, verified, published_at, byline, content_hash)
                VALUES (%s, %s, %s, %s, %s, %s, %s, true, now(), 'AI-generated', %s)
                ON CONFLICT (town_id, slug) DO UPDATE SET
                    title = EXCLUDED.title, body = EXCLUDED.body,
                    generated_by = EXCLUDED.generated_by, published_at = now(),
                    content_hash = EXCLUDED.content_hash
                """,
                (town_id, title, slug, text, ROUNDUP_SOURCE_TYPE, datetime.now(timezone.utc),
                 generated_by, new_hash),
            )
        conn.commit()
        print(f"  roundup published: {slug} ({generated_by})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
