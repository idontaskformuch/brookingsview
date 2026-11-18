"""scrapers/alerts.py send_alert (owner spec .claude/specs/alerts-send-alert.md).

Before 2026-11-18 every sender posted json={"text": msg} also to the ntfy.sh
ALERT_WEBHOOK, so the phone showed the JSON shell instead of the text; the
ntfy test below fails on that old body. The URL is a secret: no log line may
contain it, also when requests' own exception text does.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from scrapers import alerts

ROOT = Path(__file__).resolve().parent.parent
NTFY = "https://ntfy.sh/bv-test-topic-secret"
SLACK = "https://hooks.slack.com/services/T000/B000/secretsecret"
# real-format message: scrapers/runner.py's own f-string, real town/source
MSG = "[glasgow] scraper 'jobs' failat 3 ggr i rad: RuntimeError: ADZUNA_APP_ID/ADZUNA_APP_KEY saknas"


class _Resp:
    def __init__(self, status: int):
        self.status_code = status


@pytest.fixture
def calls(monkeypatch):
    seen: list[dict] = []

    def post(url, **kw):
        seen.append({"url": url, **kw})
        return _Resp(200)

    monkeypatch.setattr(alerts.requests, "post", post)
    return seen


def test_ntfy_posts_plain_utf8_text_with_headers(monkeypatch, calls):
    monkeypatch.setenv("ALERT_WEBHOOK", NTFY)
    assert alerts.send_alert(MSG + " – å", title="[glasgow] scraper jobs", priority="high") is True
    (c,) = calls
    assert c["url"] == NTFY
    assert "json" not in c
    assert c["data"] == (MSG + " – å").encode("utf-8")
    assert c["headers"]["Title"] == "[glasgow] scraper jobs"
    assert c["headers"]["Tags"] == "warning"
    assert c["headers"]["Priority"] == "high"
    assert c["headers"]["Content-Type"] == "text/plain; charset=utf-8"
    assert c["timeout"] == 10


def test_ntfy_default_priority_and_no_title(monkeypatch, calls):
    monkeypatch.setenv("ALERT_WEBHOOK", NTFY)
    alerts.send_alert(MSG)
    h = calls[0]["headers"]
    assert h["Priority"] == "default" and "Title" not in h


def test_ntfy_non_ascii_title_is_rfc2047_encoded(monkeypatch, calls):
    monkeypatch.setenv("ALERT_WEBHOOK", NTFY)
    alerts.send_alert(MSG, title="[glasgow] källa")
    t = calls[0]["headers"]["Title"]
    assert t.startswith("=?UTF-8?B?") and t.isascii()
    t.encode("latin-1")  # requests requires latin-1 header values


@pytest.mark.parametrize("url,expected", [
    ("https://ntfy.sh/topic", True),
    ("https://NTFY.SH/topic", True),
    ("https://ntfy.example.org/topic", True),
    ("https://hooks.slack.com/services/x", False),
    ("https://discord.com/api/webhooks/x", False),
    ("https://notntfy.sh/topic", False),
])
def test_is_ntfy_url(url, expected):
    assert alerts.is_ntfy_url(url) is expected


def test_slack_json_unchanged(monkeypatch, calls):
    monkeypatch.setenv("ALERT_WEBHOOK", SLACK)
    assert alerts.send_alert(MSG, title="ignored", priority="high") is True
    (c,) = calls
    assert c == {"url": SLACK, "json": {"text": MSG}, "timeout": 10}


def _boom(exc):
    def post(url, **kw):
        raise exc
    return post


@pytest.mark.parametrize("hook", [NTFY, SLACK])
@pytest.mark.parametrize("post,expect", [
    (lambda url, **kw: _Resp(500), "HTTP 500"),
    (_boom(requests.Timeout(f"HTTPSConnectionPool(host='ntfy.sh'): Read timed out. url: {NTFY} {SLACK}")), "Timeout"),
    (_boom(requests.ConnectionError(f"Max retries exceeded with url: {NTFY} {SLACK}")), "ConnectionError"),
    (_boom(ValueError(f"weird {NTFY} {SLACK}")), "ValueError"),
])
def test_failures_are_logged_never_raised_never_leak_url(monkeypatch, capsys, hook, post, expect):
    monkeypatch.setenv("ALERT_WEBHOOK", hook)
    monkeypatch.setattr(alerts.requests, "post", post)
    assert alerts.send_alert(MSG, title="t") is False
    out = capsys.readouterr()
    log = out.out + out.err
    assert expect in log and "varning" in log
    assert "bv-test-topic-secret" not in log and "secretsecret" not in log
    assert "ntfy.sh" not in log and "hooks.slack.com" not in log


def test_missing_webhook_does_nothing(monkeypatch, capsys):
    monkeypatch.delenv("ALERT_WEBHOOK", raising=False)
    monkeypatch.setattr(alerts.requests, "post", lambda *a, **k: pytest.fail("posted without ALERT_WEBHOOK"))
    assert alerts.send_alert(MSG) is False
    assert "ALERT_WEBHOOK saknas" in capsys.readouterr().err


def test_cli_exit_code(monkeypatch, calls):
    monkeypatch.setenv("ALERT_WEBHOOK", NTFY)
    assert alerts.main(["Testlarm från alert-test.yml", "--title", "[alla] alert-test"]) == 0
    monkeypatch.delenv("ALERT_WEBHOOK")
    assert alerts.main(["x"]) == 1


# --- every sender goes through send_alert, with its own title/priority ---

def _call_runner():
    from scrapers import runner
    runner._alert("glasgow", "jobs", 3, "RuntimeError: x")


def _call_publish():
    from ai_pipeline import publish
    publish._alert("brookings_sd", "meeting #1 discarded 3 consecutive runs")


def _call_staleness():
    from datetime import datetime, timezone
    from scrapers import staleness
    r = staleness.StalenessResult("broomfield_co", "events", "events", datetime(2026, 11, 1, tzinfo=timezone.utc), 7, True)
    staleness._alert([r])


def _call_liveness():
    from scripts import check_scrape_liveness
    check_scrape_liveness._alert("No recent successful scrape", ["glasgow", "moreno_valley_ca"])


def _call_freshness():
    from scripts import check_freshness
    check_freshness._alert("Stale data jobs", ["brookings_sd"])


def _call_deployed():
    from scripts import check_deployed_content
    check_deployed_content._alert("moreno_valley_ca", "HTTP 503")


@pytest.mark.parametrize("call,title,priority", [
    (_call_runner, "[glasgow] scraper jobs", "default"),
    (_call_publish, "[brookings_sd] publish gave up on a record", "default"),
    (_call_staleness, "[broomfield_co] source staleness", "default"),
    (_call_liveness, "[glasgow,moreno_valley_ca] no recent scrape", "high"),
    (_call_freshness, "[brookings_sd] stale data jobs", "default"),
    (_call_deployed, "[moreno_valley_ca] post-deploy check failed", "high"),
])
def test_each_sender_uses_send_alert(monkeypatch, calls, call, title, priority):
    monkeypatch.setenv("ALERT_WEBHOOK", NTFY)
    call()
    (c,) = calls
    assert c["headers"]["Title"] == title
    assert c["headers"]["Priority"] == priority
    assert isinstance(c["data"], bytes) and c["data"]


def test_no_python_module_reads_alert_webhook_except_alerts():
    """A new sender that posts on its own would bypass the ntfy format and
    the failure logging again."""
    offenders = []
    for p in ROOT.rglob("*.py"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("node_modules/", ".venv/", "site/", "tests/", "scratch_")) or rel == "scrapers/alerts.py":
            continue
        if re.search(r"""environ(\.get\(|\[)\s*["']ALERT_WEBHOOK""", p.read_text(encoding="utf-8", errors="replace")):
            offenders.append(rel)
    assert offenders == []
