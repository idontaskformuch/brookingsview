"""Curated källa för media_recension: vad som recenseras varje onsdag.

Det finns ingen scraper för "vad som går på bio/streamas just nu" i den här
pipelinen, och att bygga en är utanför scopet för ett enkelt underlag (se
PLAN.md, Innehållsspår v1). Detta är medvetet den enkla lösningen: en lista
riktiga, verifierbara titlar (år, regissör/skapare, genre, en saklig
premiss-beskrivning utan spoilers), konsumerad round-robin efter ISO-veckonummer
-- deterministiskt, inget tillståndsfilter att tappa bort mellan körningar.

UNDERHÅLL: listan MÅSTE fyllas på med jämna mellanrum av en människa. Utan
påfyllning cyklar den om efter ~len(WATCHLIST) veckor, och originality_check
kommer då (korrekt) avvisa en nästan identisk omrecension av samma titel --
vilket bara betyder att onsdagar tyst slutar publicera igen, inte ett fel i
sig, men ett tecken på att listan behöver nya poster.
"""
from __future__ import annotations

import datetime

WATCHLIST: list[dict] = [
    {
        "title": "Sinners", "year": 2025, "medium": "film",
        "background": (
            "Directed by Ryan Coogler, starring Michael B. Jordan in a dual role as twin "
            "brothers who open a juke joint in 1932 Mississippi Delta. A vampire horror "
            "film woven through with blues music and Southern Gothic atmosphere. Available "
            "for home streaming after a strong theatrical run."
        ),
    },
    {
        "title": "The Bear", "year": 2022, "medium": "TV series (FX/Hulu, ongoing)",
        "background": (
            "Created by Christopher Storer, starring Jeremy Allen White as a young chef "
            "who returns to Chicago to run his late brother's sandwich shop. A kitchen "
            "drama-comedy about grief, family, and the chaos of restaurant work."
        ),
    },
    {
        "title": "Dune: Part Two", "year": 2024, "medium": "film",
        "background": (
            "Directed by Denis Villeneuve, starring Timothee Chalamet, continuing the "
            "adaptation of Frank Herbert's novel. A large-scale science fiction epic about "
            "prophecy, empire, and desert survival."
        ),
    },
    {
        "title": "Severance", "year": 2022, "medium": "TV series (Apple TV+, ongoing)",
        "background": (
            "Created by Dan Erickson, starring Adam Scott, about employees who undergo a "
            "procedure that splits their memories between work and home life. A workplace "
            "thriller with a strong satirical edge."
        ),
    },
    {
        "title": "Oppenheimer", "year": 2023, "medium": "film",
        "background": (
            "Directed by Christopher Nolan, starring Cillian Murphy as J. Robert "
            "Oppenheimer. A biographical drama about the physicist who led the Manhattan "
            "Project and the moral weight of that legacy."
        ),
    },
    {
        "title": "Ted Lasso", "year": 2020, "medium": "TV series (Apple TV+, concluded 2023)",
        "background": (
            "Created by Bill Lawrence, Jason Sudeikis, Brendan Hunt, and Joe Kelly, "
            "starring Sudeikis as an American football coach hired to manage an English "
            "soccer club. A comedy-drama about kindness as a management style."
        ),
    },
    {
        "title": "Poor Things", "year": 2023, "medium": "film",
        "background": (
            "Directed by Yorgos Lanthimos, starring Emma Stone, based on the novel by Alasdair "
            "Gray. A dark comedy fantasy about a reanimated young woman discovering the "
            "world on her own terms."
        ),
    },
    {
        "title": "Only Murders in the Building", "year": 2021, "medium": "TV series (Hulu, ongoing)",
        "background": (
            "Created by Steve Martin and John Hoffman, starring Martin, Martin Short, and "
            "Selena Gomez as three strangers who bond over a true-crime podcast about a "
            "death in their apartment building. A comedy mystery."
        ),
    },
    {
        "title": "The Zone of Interest", "year": 2023, "medium": "film",
        "background": (
            "Directed by Jonathan Glazer, based on the novel by Martin Amis. A drama about "
            "the family of an Auschwitz commandant living an ordinary domestic life next to "
            "the camp, told almost entirely through sound and implication rather than "
            "depicted violence."
        ),
    },
    {
        "title": "Slow Horses", "year": 2022, "medium": "TV series (Apple TV+, ongoing)",
        "background": (
            "Based on Mick Herron's novels, starring Gary Oldman as the head of a dumping-"
            "ground unit for disgraced British intelligence officers. A spy thriller with a "
            "dry comic streak."
        ),
    },
    {
        "title": "Anatomy of a Fall", "year": 2023, "medium": "film",
        "background": (
            "Directed by Justine Triet, winner of the Palme d'Or. A French courtroom drama "
            "about a writer standing trial for her husband's death, and how a marriage looks "
            "different depending on who is describing it."
        ),
    },
    {
        "title": "Fargo", "year": 2014, "medium": "TV anthology series (FX, ongoing)",
        "background": (
            "Created by Noah Hawley, an anthology series inspired by the Coen brothers' "
            "film, each season a new crime story set in the Upper Midwest. Close to home "
            "geographically and in temperament for South Dakota readers."
        ),
    },
    {
        "title": "Nomadland", "year": 2020, "medium": "film",
        "background": (
            "Directed by Chloe Zhao, starring Frances McDormand as a woman who takes up a "
            "nomadic life in a van after economic hardship, working seasonal jobs across "
            "the American West. Based on Jessica Bruder's nonfiction book."
        ),
    },
    {
        "title": "Reservation Dogs", "year": 2021, "medium": "TV series (FX/Hulu, concluded 2023)",
        "background": (
            "Created by Sterlin Harjo and Taika Waititi, about four Indigenous teenagers in "
            "rural Oklahoma navigating grief and small-town life. A comedy-drama with a "
            "specifically Native American perspective, notable for its almost entirely "
            "Indigenous cast and crew."
        ),
    },
]


def next_pick(today: datetime.date) -> dict:
    """Deterministic round-robin pick by ISO week number -- same pick if rerun the
    same week, cycles through the list roughly every len(WATCHLIST) weeks."""
    iso_week = today.isocalendar().week
    return WATCHLIST[iso_week % len(WATCHLIST)]


def build_local_input(pick: dict) -> str:
    return (
        f"Title: {pick['title']} ({pick['year']}), {pick['medium']}.\n\n"
        f"{pick['background']}"
    )
