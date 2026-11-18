"""Shared alert sender for scrapers/, ai_pipeline/ and scripts/ (owner spec
.claude/specs/alerts-send-alert.md, 2026-11-18).

ALERT_WEBHOOK decides the format:
- an ntfy URL (host ntfy.sh, or any host whose name has an "ntfy" label,
  e.g. ntfy.example.org for a self-hosted server): POST the message as
  plain UTF-8 text with Title/Tags/Priority headers, so the phone shows the
  text itself, not a JSON shell;
- anything else: the old Slack-style json={"text": msg}.

An alert must never stop a scrape and must never fail silently: every
non-2xx answer or exception is logged (status code / exception type only --
the URL is a secret and is never printed, and requests' own exception text
contains it, so str(exc) is never printed either), and nothing is re-raised.

    python -m scrapers.alerts "message" --title "..." [--priority high]
exits 1 when the alert was not delivered (used by alert-test.yml).
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from urllib.parse import urlparse

import requests

TIMEOUT_S = 10


def is_ntfy_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "ntfy.sh" or "ntfy" in host.split(".")


def _header_value(text: str) -> str:
    """HTTP header values must be latin-1 in requests; ntfy decodes RFC 2047
    encoded words, so non-ASCII titles go as =?UTF-8?B?...?=."""
    if text.isascii():
        return text
    return "=?UTF-8?B?" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "?="


def _log(line: str) -> None:
    print(f"[alert] {line}", file=sys.stderr)


def send_alert(msg: str, title: str | None = None, priority: str = "default") -> bool:
    """Send msg to ALERT_WEBHOOK. Returns True when the webhook answered
    2xx, False otherwise (no webhook, non-2xx, exception). Never raises."""
    hook = os.environ.get("ALERT_WEBHOOK")
    if not hook:
        _log("info: ALERT_WEBHOOK saknas, inget larm skickat")
        return False
    try:
        if is_ntfy_url(hook):
            headers = {
                "Content-Type": "text/plain; charset=utf-8",
                "Tags": "warning",
                "Priority": priority,
            }
            if title:
                headers["Title"] = _header_value(title)
            resp = requests.post(hook, data=msg.encode("utf-8"), headers=headers, timeout=TIMEOUT_S)
        else:
            resp = requests.post(hook, json={"text": msg}, timeout=TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 -- an alert must never stop the caller
        _log(f"varning: larmet kunde inte skickas ({exc.__class__.__name__})")
        return False
    if not 200 <= resp.status_code < 300:
        _log(f"varning: larmet avvisades (HTTP {resp.status_code})")
        return False
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Send one alert via ALERT_WEBHOOK.")
    ap.add_argument("message")
    ap.add_argument("--title")
    ap.add_argument("--priority", default="default")
    args = ap.parse_args(argv)
    ok = send_alert(args.message, title=args.title, priority=args.priority)
    print("larm skickat" if ok else "larm INTE skickat")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
