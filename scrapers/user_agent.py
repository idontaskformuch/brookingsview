"""The User-Agent every outgoing scraper/pipeline request identifies itself with.

One neutral bot name for all three sites, with the town's own contact page, e.g.
"ViewMediaBot (+https://brookingsview.com/contact)" -- an honest, identifiable
client (never a spoofed browser string) whose contact URL is the town the request
is made for, instead of the same "brookingsview.com" string everywhere.

An explicit USER_AGENT environment variable still wins (the per-town GitHub
workflows set it to the same format), so a source owner who allow-lists us by
name gets exactly one string per town.
"""
from __future__ import annotations

import os

BOT_NAME = "ViewMediaBot"

SITE_DOMAINS: dict[str, str] = {
    "brookings_sd": "brookingsview.com",
    "moreno_valley_ca": "morenovalleyview.com",
    "broomfield_co": "broomfieldview.com",
}
DEFAULT_TOWN = "brookings_sd"


def user_agent_for_domain(domain: str) -> str:
    domain = domain.removeprefix("https://").removeprefix("http://").strip("/")
    return f"{BOT_NAME} (+https://{domain}/contact)"


def user_agent(town_id: str | None = None) -> str:
    """USER_AGENT env override, else the town's neutral bot string."""
    override = os.environ.get("USER_AGENT")
    if override:
        return override
    return user_agent_for_domain(SITE_DOMAINS.get(town_id or DEFAULT_TOWN, SITE_DOMAINS[DEFAULT_TOWN]))
