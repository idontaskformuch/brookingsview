"""Per-call cost logging for every paid API in the pipeline (api_usage table).

Spec: API Cost Logging (2026-10-01). Measurement only -- nothing in this
module changes what the pipeline publishes; a logging failure is always a
warning, never a propagated exception (see log_usage()'s docstring).

usage_context() sets generator/town_id/run_id ONCE at a script's entry point
(after cfg/town_id are known) via contextvars, so safe_create() and the
other provider call sites (brave_search(), generate_illustration()) don't
need those three threaded through every function signature in between --
only `attempt`, which genuinely varies call-to-call inside a single
generation's own retry closure, is passed explicitly at each call site.

One real exception: ai_pipeline/format_prompt.py's format_record() is called
once per record (meeting/event/alert) from publish.py, with a `source_type`
that varies PER CALL within a single script run -- not a true "set once"
constant the way weekly.py's or workplace_watch_digest.py's single
generator name is. For that one call site, format_record() opens its own
narrow, nested usage_context(generator=source_type) around just that
record's calls, overriding the (town_id/run_id-only) context publish.py set
at its own entry. Nesting composes correctly: an inner usage_context() only
overrides the vars it's given and restores the outer ones on exit.
"""
from __future__ import annotations

import os
import sys
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

from db.db import get_conn

_generator_var: ContextVar[str | None] = ContextVar("api_usage_generator", default=None)
_town_id_var: ContextVar[str | None] = ContextVar("api_usage_town_id", default=None)
_run_id_var: ContextVar[str | None] = ContextVar("api_usage_run_id", default=None)

# Side channel from safe_create() back to its caller: the anthropic SDK's
# Message is a pydantic model that doesn't allow stapling an extra attribute
# onto it, so safe_create() can't just return `msg.usage_id` alongside the
# real response without changing its return type (which would break all 16
# existing call sites' `msg = safe_create(...)`). Calls within one Python
# thread/task run strictly sequentially, so "set right before returning,
# read immediately after by the one caller who just made the call" is safe
# -- this is not meant to survive concurrency or be read by anyone but the
# caller that triggered the preceding safe_create().
_last_usage_id_var: ContextVar[int | None] = ContextVar("api_usage_last_id", default=None)


def _set_last_usage_id(usage_id: int | None) -> None:
    _last_usage_id_var.set(usage_id)


def take_last_usage_id() -> int | None:
    """Pop the usage_id safe_create() just logged for the call you made.
    Call this immediately after `msg = safe_create(...)`, before any other
    safe_create() call -- it also clears the slot, so a caller that forgets
    to read it doesn't silently see a stale id from a previous call."""
    usage_id = _last_usage_id_var.get()
    _last_usage_id_var.set(None)
    return usage_id

_process_run_id: str | None = None


def _default_run_id() -> str:
    """One id per process, shared by every call that doesn't explicitly
    override it -- a GitHub Actions run_id+attempt when running in Actions
    (groups every call from one scheduled/dispatched workflow run, matching
    the spec's "t.ex. en cron-körning"), otherwise a fresh uuid4 per local
    process."""
    global _process_run_id
    if _process_run_id is None:
        gh_run = os.environ.get("GITHUB_RUN_ID")
        if gh_run:
            _process_run_id = f"{gh_run}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
        else:
            _process_run_id = f"local-{uuid.uuid4()}"
    return _process_run_id


@contextmanager
def usage_context(generator: str | None = None, town_id: str | None = None, run_id: str | None = None):
    """Set once at a script's entry point. Nestable -- see module docstring
    for format_record()'s per-record override case. Any of the three left
    as None inherits whatever the enclosing context (or the process-wide
    run_id default) already has, rather than clearing it to None."""
    tok_g = _generator_var.set(generator if generator is not None else _generator_var.get())
    tok_t = _town_id_var.set(town_id if town_id is not None else _town_id_var.get())
    tok_r = _run_id_var.set(run_id or _run_id_var.get() or _default_run_id())
    try:
        yield
    finally:
        _generator_var.reset(tok_g)
        _town_id_var.reset(tok_t)
        _run_id_var.reset(tok_r)


def set_default_context(generator: str | None = None, town_id: str | None = None, run_id: str | None = None) -> None:
    """Set generator/town_id/run_id for the rest of this process, with no
    matching reset -- for a script's main(), which only ever exits by the
    process ending, not by returning into other unrelated work the way a
    scoped `with usage_context():` block would need to unwind for. Call this
    once, right after cfg/town_id are parsed, instead of wrapping the whole
    rest of main() in a `with` block (which would force re-indenting
    everything below it for no real benefit in a script that never does
    anything else after this point)."""
    _generator_var.set(generator if generator is not None else _generator_var.get())
    _town_id_var.set(town_id if town_id is not None else _town_id_var.get())
    _run_id_var.set(run_id or _run_id_var.get() or _default_run_id())


def _warn(msg: str) -> None:
    print(f"  [api_usage] {msg}", file=sys.stderr)


def log_usage(provider: str, *, model: str | None = None,
              input_tokens: int | None = None, output_tokens: int | None = None,
              cache_read_tokens: int | None = None, cache_write_tokens: int | None = None,
              units: int | None = None, cost_usd: float | None = None,
              attempt: int = 1, outcome: str = "pending",
              generator: str | None = None, town_id: str | None = None,
              run_id: str | None = None) -> int | None:
    """Insert one api_usage row. Returns its id (for a later
    finalize_outcome() call) or None.

    NEVER raises. Spec requirement #6: "Fel i loggningen fångas och skrivs
    som varning. Ett misslyckat logganrop får aldrig stoppa en publicering."
    -- a DB outage here must degrade to a stderr warning, not take down a
    generator run that otherwise has a perfectly good article/digest to
    publish. Blanket except is deliberate for that reason.
    """
    g = generator or _generator_var.get()
    if not g:
        _warn("log_usage() called with no generator set (no usage_context() active and no "
              "explicit generator= given) -- logging generator='unknown' rather than dropping the row")
        g = "unknown"
    t = town_id or _town_id_var.get()
    r = run_id or _run_id_var.get() or _default_run_id()
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO api_usage
                    (run_id, town_id, generator, provider, model, input_tokens, output_tokens,
                     cache_read_tokens, cache_write_tokens, units, cost_usd, attempt, outcome)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (r, t, g, provider, model, input_tokens, output_tokens,
                 cache_read_tokens, cache_write_tokens, units, cost_usd, attempt, outcome),
            )
            row = cur.fetchone()
        usage_id = row[0] if row else None
    except Exception as exc:  # noqa: BLE001 -- see docstring, logging must never be fatal
        _warn(f"failed to log usage ({provider}/{model}): {exc}")
        usage_id = None
    _set_last_usage_id(usage_id)
    return usage_id


def finalize_outcome(usage_id: int | None, outcome: str) -> None:
    """UPDATE a previously-logged row's outcome once the pipeline knows how
    the call was actually used. usage_id=None (log_usage() itself already
    failed, or a caller chose not to track this call's outcome) is a silent
    no-op -- the warning already happened once, at log_usage() time."""
    if usage_id is None:
        return
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE api_usage SET outcome = %s WHERE id = %s", (outcome, usage_id))
    except Exception as exc:  # noqa: BLE001
        _warn(f"failed to finalize outcome for usage row {usage_id}: {exc}")


def finalize_generation(usage_ids: list[int], succeeded: bool, fallback_outcome: str = "template_fallback",
                         success_outcome: str = "published") -> None:
    """Common end-of-generation finalizer for the "call, maybe retry once,
    then succeed or give up" shape every generator in this pipeline shares
    (content/_base.generate_article(), format_prompt.format_record(),
    weekly.generate(), and the other digest scripts' own generate()-style
    functions).

    `usage_ids`: every usage_id collected (in call order) from this one
    generation's safe_create() calls -- i.e. one per attempt. Every attempt
    except the last was, by definition, retried because it got rejected, so
    it's logged 'guardrail_rejected'. The LAST attempt gets 'published' if
    the generation ultimately succeeded, otherwise `fallback_outcome` --
    'template_fallback' for generators that have a real TEMPLATERS/
    template_fallback() path, or 'guardrail_rejected' for content/_base.py's
    content track, which has no template concept and genuinely publishes
    nothing ("ingen artikel idag") on a final failure.

    `success_outcome`: override for a successful generation that still
    won't be published -- e.g. weekly.py's --dry-run, which makes a real,
    full-price AI call but never writes to stories, so cost_report.py's
    waste query (outcome NOT IN ('published','dry_run')) needs 'dry_run'
    here, not 'published', to keep its published-cost numbers honest.
    """
    if not usage_ids:
        return
    for usage_id in usage_ids[:-1]:
        finalize_outcome(usage_id, "guardrail_rejected")
    finalize_outcome(usage_ids[-1], success_outcome if succeeded else fallback_outcome)
