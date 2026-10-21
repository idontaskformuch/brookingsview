"""One neutral bot name, the town's own contact page; no more "brookingsview.com" everywhere."""
import re
from pathlib import Path

import pytest

from scrapers.user_agent import BOT_NAME, SITE_DOMAINS, user_agent, user_agent_for_domain

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize("town,domain", [
    ("brookings_sd", "brookingsview.com"),
    ("moreno_valley_ca", "morenovalleyview.com"),
    ("broomfield_co", "broomfieldview.com"),
])
def test_default_user_agent_is_neutral_and_per_town(town, domain, monkeypatch):
    monkeypatch.delenv("USER_AGENT", raising=False)
    assert user_agent(town) == f"ViewMediaBot (+https://{domain}/contact)"
    assert BOT_NAME in user_agent(town) and "@" not in user_agent(town)


def test_env_override_wins(monkeypatch):
    monkeypatch.setenv("USER_AGENT", "ViewMediaBot (+https://example.test/contact)")
    assert user_agent("broomfield_co") == "ViewMediaBot (+https://example.test/contact)"


def test_domain_helper_strips_scheme():
    assert user_agent_for_domain("https://morenovalleyview.com") == "ViewMediaBot (+https://morenovalleyview.com/contact)"


def test_every_workflow_sets_the_neutral_agent_for_its_own_town():
    pat = re.compile(r'USER_AGENT:\s+"([^"]+)"')
    seen = 0
    for wf in (ROOT / ".github" / "workflows").glob("*.yml"):
        for ua in pat.findall(wf.read_text(encoding="utf-8")):
            seen += 1
            assert re.fullmatch(r"ViewMediaBot \(\+https://(%s)/contact\)" % "|".join(map(re.escape, SITE_DOMAINS.values())), ua), f"{wf.name}: {ua}"
    assert seen >= 15


def test_no_code_hardcodes_the_old_string():
    old = re.compile(r"(brookingsview|morenovalleyview|broomfieldview)\.com \(contact")
    offenders = []
    for folder in ("scrapers", "ai_pipeline", "content", "scripts"):
        for p in (ROOT / folder).rglob("*.py"):
            if old.search(p.read_text(encoding="utf-8")):
                offenders.append(str(p.relative_to(ROOT)))
    assert offenders == []
