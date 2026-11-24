"""One alert per problem, not one per run (owner 2026-11-24).

A check that finds the same problem on every run used to send the same ntfy message on every run. reconcile() keeps one row per problem in
alert_state (db/migrations/075_alert_state.sql) and sends:

  * NEW        the first run that sees the problem                         -> one message
  * REMINDER   a later run, at least REMIND_AFTER_H hours after the last   -> one message per day while the problem lasts
  * RESOLVED   a run where an earlier open problem is no longer found      -> one message

Nothing else is sent, so a run that sees an already-reported problem is silent. At most one message of each kind per run, however many problems
there are (the lines are listed in the message). Alerts must never be lost: if the table is missing or the database cannot be reached the caller
gets `None` back and sends its old, per-run alert instead.

`scope` is a key prefix that belongs to one checker; only keys under it are resolved, so one checker never closes another's problems.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from typing import Callable

from scrapers.alerts import send_alert

REMIND_AFTER_H = 20  # a daily run drifts by minutes; 24 would skip a day now and then


def _first_line(text: str) -> str:
    return text.strip().splitlines()[0] if text.strip() else ""


def decide(open_rows: dict[str, tuple[datetime, datetime]], active: dict[str, str], now: datetime) -> tuple[list[str], list[str], list[str]]:
    """Pure. open_rows: key -> (first_seen_at, last_notified_at) of the unresolved rows in scope. Returns (new, reminders, resolved) keys."""
    new = sorted(k for k in active if k not in open_rows)
    reminders = sorted(k for k in active if k in open_rows and now - open_rows[k][1] >= timedelta(hours=REMIND_AFTER_H))
    resolved = sorted(k for k in open_rows if k not in active)
    return new, reminders, resolved


def reconcile(conn, scope: str, active: dict[str, str], title: str, priority: str = "default", now: datetime | None = None,
              send: Callable[..., bool] = send_alert) -> dict[str, list[str]] | None:
    """active: alert_key (starting with `scope`) -> one-line message. Returns {"new": [...], "reminder": [...], "resolved": [...]} (keys), or
    None when the state could not be read or written, in which case NOTHING was sent and the caller must send its own alert."""
    now = now or datetime.now(timezone.utc)
    try:
        rows = conn.execute("SELECT alert_key, first_seen_at, last_notified_at, last_message FROM alert_state "
                            "WHERE resolved_at IS NULL AND starts_with(alert_key, %s)", (scope,)).fetchall()
        open_rows = {r[0]: (r[1], r[2]) for r in rows}
        last_message = {r[0]: r[3] for r in rows}
        new, reminders, resolved = decide(open_rows, active, now)
        out = {"new": new, "reminder": reminders, "resolved": resolved}
        # Write first: a send that succeeds but a state write that fails would repeat the alert on every run.
        for k in new:
            conn.execute("INSERT INTO alert_state (alert_key, first_seen_at, last_notified_at, last_message, notified_count, resolved_at) "
                         "VALUES (%s, %s, %s, %s, 1, NULL) ON CONFLICT (alert_key) DO UPDATE SET first_seen_at = EXCLUDED.first_seen_at, "
                         "last_notified_at = EXCLUDED.last_notified_at, last_message = EXCLUDED.last_message, notified_count = 1, resolved_at = NULL",
                         (k, now, now, active[k]))
        for k in reminders:
            conn.execute("UPDATE alert_state SET last_notified_at = %s, last_message = %s, notified_count = notified_count + 1 WHERE alert_key = %s",
                         (now, active[k], k))
        for k in resolved:
            conn.execute("UPDATE alert_state SET resolved_at = %s WHERE alert_key = %s", (now, k))
        conn.commit()
    except Exception as exc:  # noqa: BLE001 -- table not migrated yet, read-only run, no connection: fall back, never swallow an alert
        print(f"[alert_state] unavailable ({exc.__class__.__name__}); the caller sends its own alert", file=sys.stderr)
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None

    if new:
        send("New problem:\n  " + "\n  ".join(active[k] for k in new), title=title, priority=priority)
    if reminders:
        days = {k: (now - open_rows[k][0]).days for k in reminders}
        send("Still open (daily reminder):\n  " + "\n  ".join(f"{active[k]} [day {days[k] + 1}]" for k in reminders), title=f"{title} -- still open", priority=priority)
    if resolved:
        send("Resolved, no longer found:\n  " + "\n  ".join(_first_line(last_message[k]) for k in resolved), title=f"{title} -- resolved")
    return out
