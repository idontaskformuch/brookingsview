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
    "glasgow": "glasgowloop.co.uk",
}


def user_agent_for_domain(domain: str) -> str:
    domain = domain.removeprefix("https://").removeprefix("http://").strip("/")
    return f"{BOT_NAME} (+https://{domain}/contact)"


def user_agent(town_id: str | None = None) -> str:
    """USER_AGENT env override, else the town's neutral bot string.

    A missing or unknown town id raises (audit Fas 2, P4-3): there is no fallback town, so a
    request is never sent with another town's contact page by accident.
    """
    override = os.environ.get("USER_AGENT")
    if override:
        return override
    if town_id not in SITE_DOMAINS:
        raise ValueError(f"user_agent: unknown town id {town_id!r} (known: {', '.join(SITE_DOMAINS)}); set USER_AGENT or pass the town")
    return user_agent_for_domain(SITE_DOMAINS[town_id])
