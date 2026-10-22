"""UK publication gate (Glasgow spec phase 5) -- a HOLD, never a rewrite.

Applies only to towns whose config says country "gb" (is_uk). Two hard rules
from the owner (2026-10-22), both fail-closed: a record that trips either one
is held (not published, not sent to the AI) and is re-evaluated every run, so
it heals by itself if the source text changes.

1. SCOTTISH CONTEMPT OF COURT (spec phase 5): hold anything about arrests,
   charges, sheriff / High Court proceedings, trials or named suspects.
   contempt_hits() is a keyword net over the SOURCE text and the generated
   text. It over-matches on purpose ("Sheriff Principal" in a committee title
   is held too): a false hold costs one story, a false pass is a legal risk.

2. NO NAMES OF PRIVATE INDIVIDUALS (licensing: personal licence holders and
   applicants; planning: applicants, objectors, appellants). Addresses are
   fine. private_person_hits() flags
     - any mention of a personal licence,
     - a role label (applicant, appellant, objector, licence holder ...)
       followed by a capitalised name,
     - an honorific (Mr, Mrs, Ms, Miss, Mx, Dr) followed by a capitalised name,
     - a common UK first name followed by a capitalised surname.
   Public office-holders are exempt only when introduced by their office
   (Councillor / Cllr / Provost / Bailie / MSP / MP ...): those spans are
   removed before the checks. Named council OFFICERS are NOT exempt (they
   trip the first-name rule); that is a known false-hold, to be handled with
   an allow-list when a real case appears -- never by loosening the rule.

The name check is a heuristic net, not a proof. It is the second line behind
exclude_bodies (Personnel Appeals Committee is never stored) and the
town-wide compliance setting publish_named_private_individuals=false.
"""
from __future__ import annotations

import re

_PUBLIC_TITLE = (
    r"(?:Lord\s+Provost|Depute\s+Provost|Provost|Councillors?|Cllrs?\.?|Bailie|MSPs?|MPs?|MEPs?|First\s+Minister)"
)
_NAME_WORD = r"[A-Z][A-Za-z'’-]+"
# "Councillor Elaine McSporran", "Councillors Ruairi Kelly and Richard Bell"
_PUBLIC_OFFICE_SPAN = re.compile(
    rf"\b{_PUBLIC_TITLE}\s+{_NAME_WORD}(?:\s+{_NAME_WORD}){{0,2}}(?:\s+and\s+{_NAME_WORD}(?:\s+{_NAME_WORD}){{0,2}})?"
)

_CONTEMPT = re.compile(
    r"\b("
    r"arrest(?:s|ed|ing)?|charged|charges?\s+(?:of|against|with)|accused|suspects?|suspected|"
    r"alleged(?:ly)?|offender|perpetrator|"
    r"sheriff(?:\s+court|\s+principal)?|sheriffs|high\s+court|court\s+of\s+session|justiciary|"
    r"procurator\s+fiscal|crown\s+office|indict(?:ed|ment)|trial|jury|"
    r"convict(?:ed|ion|ions)|sentenc(?:e|ed|ing)|remand(?:ed)?|bail|"
    r"pleaded|plea\s+hearing|appeared\s+in\s+court|court\s+appearance|"
    r"murder|manslaughter|culpable\s+homicide|assault(?:ed)?|stabb(?:ed|ing)|"
    r"police\s+(?:investigat\w+|enquir\w+)|under\s+investigation"
    r")\b",
    re.IGNORECASE,
)

_PERSONAL_LICENCE = re.compile(r"\bpersonal\s+licen[cs]e", re.IGNORECASE)
_ROLE_NAME = re.compile(
    r"\b(?:applicants?|appellants?|objectors?|complainers?|complainants?|respondents?|"
    r"licen[cs]e\s*holders?|licen[cs]ees?|(?:premises|personal)\s+licen[cs]e\s*holders?|"
    r"on\s+behalf\s+of|application\s+by|appeal\s+by|objection\s+by|submitted\s+by|"
    r"agent)\s*[:\-–]?\s*(?:is\s+|are\s+)?(?:(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+)?"
    rf"({_NAME_WORD}\s+{_NAME_WORD})"
)
_HONORIFIC_NAME = re.compile(rf"\b(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+{_NAME_WORD}")

_FIRST_NAMES = frozenset("""
Aaron Abigail Adam Agnes Aidan Aileen Alan Alasdair Alastair Alexander Alexandra Alice Alison Allan Amanda Amy Andrea Andrew Angus Anita Ann Anna Anne Annie Anthony Archie Arthur Barbara Barry Ben Benjamin Beth Bethany Billy Bob Brian Bruce Callum Calum Cameron Campbell Carol Caroline Catherine Charles Charlotte Chloe Chris Christine Christopher Claire Colin Connor Craig Daniel Darren David Dawn Debbie Deborah Declan Denise Dennis Derek Diane Donald Donna Douglas Duncan Edward Eilidh Elaine Eleanor Elizabeth Ellen Emily Emma Eric Euan Evelyn Ewan Fiona Frances Francis Frank Gary Gavin George Gerald Gillian Gordon Graeme Graham Grant Gregor Gregory Hamish Hannah Harry Heather Helen Henry Hugh Iain Ian Isabel Isla Jack Jacqueline Jake James Jamie Jane Janet Jason Jean Jeffrey Jennifer Jenny Jessica Jill Joan Joanne John Jonathan Joseph Joshua Joyce Julie Karen Kate Katherine Kathleen Kathryn Keith Kelly Kenneth Kevin Kirsty Kyle Laura Lauren Lee Leslie Lesley Linda Lindsay Lisa Liam Lorna Louise Lucy Lynn Lynne Malcolm Margaret Maria Marion Mark Martin Mary Matthew Maureen Megan Melanie Michael Michelle Mohammed Mohammad Muhammad Morag Moira Murdo Murray Nancy Natalie Neil Nicola Nicole Nigel Norman Olivia Pamela Patricia Patrick Paul Pauline Peter Philip Rachel Ralph Rebecca Reece Richard Robert Robin Rona Ronald Rory Rosemary Ross Roy Ruairi Ruari Russell Ruth Ryan Sally Samantha Samuel Sandra Sarah Scott Sean Shaun Sheila Shona Simon Sophie Stephanie Stephen Steven Stewart Stuart Susan Suzanne Tam Tanya Terence Teresa Thomas Tracy Tom Tony Valerie Victor Vincent Wendy William Yvonne Zoe
""".split())

# A surname slot holding one of these is a street / place / organisation
# ("Victoria Park", "Charlotte Street", "Mary Hill"), not a person.
_PLACE_WORDS = frozenset("""
Street St Road Rd Park Drive Avenue Ave Place Lane Gardens Garden Square Hospital School Crescent Terrace Court Way Hall Centre Center Church
Bridge Cross Area Partnership Primary Secondary Academy Library Station Row Circus Brae Green Quay Wynd Close Hill Hills Gate Walk Path Grove
Mews Brae Yard Wharf Port Loan Rise View Gait Cathedral Hotel Pub Bar Club Cafe Restaurant Shop Store Lodge House Mill Works Estate Campus
University College Museum Gallery Theatre Cinema Arena Stadium Pool Baths Market Mall Retail Industrial Business Housing Association Trust Council
Committee Board Group Foundation Fund Limited Ltd Plc Services Service Hub
""".split())


def is_uk(cfg: dict) -> bool:
    return (cfg or {}).get("country") == "gb"


def _without_public_offices(text: str) -> str:
    return _PUBLIC_OFFICE_SPAN.sub(" ", text)


def contempt_hits(text: str) -> list[str]:
    return sorted({m.group(1).lower() for m in _CONTEMPT.finditer(text or "")})


def _first_name_surname_hits(text: str) -> list[str]:
    hits = []
    words = re.findall(r"[A-Za-z'’-]+", text)
    for i in range(len(words) - 1):
        first, nxt = words[i], words[i + 1]
        if first in _FIRST_NAMES and nxt[:1].isupper() and nxt not in _PLACE_WORDS:
            # "Victoria Park Area Partnership": the word after the surname slot
            # being a place word shows the pair is a place/organisation name.
            after = words[i + 2] if i + 2 < len(words) else ""
            if after in _PLACE_WORDS:
                continue
            hits.append(f"{first} {nxt}")
    return hits


def private_person_hits(text: str) -> list[str]:
    """Reasons (short strings) why `text` may name a private individual."""
    text = _without_public_offices(text or "")
    hits: list[str] = []
    if _PERSONAL_LICENCE.search(text):
        hits.append("personal licence")
    hits += [f"role+name: {m.group(0).strip()}" for m in _ROLE_NAME.finditer(text)]
    hits += [f"honorific: {m.group(0)}" for m in _HONORIFIC_NAME.finditer(text)]
    hits += [f"name: {h}" for h in _first_name_surname_hits(text)]
    return hits


def hold_reasons(cfg: dict, *texts: str) -> list[str]:
    """Empty list = may proceed. Non-empty = HOLD (never auto-publish)."""
    if not is_uk(cfg):
        return []
    reasons: list[str] = []
    for text in texts:
        reasons += [f"contempt: {w}" for w in contempt_hits(text)]
        reasons += [f"private person: {h}" for h in private_person_hits(text)]
    return list(dict.fromkeys(reasons))
