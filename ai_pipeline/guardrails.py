"""Guardrails — säkerhetsnätet mot hallucination och olämpligt innehåll.

Detta är ett NÄT, inte en ursäkt för slarvig prompt. Förstahandsförsvaret är att
mata AI-lagret med strukturerade fält och be den väva ihop dem extraktivt. Guardrails
fångar det som ändå slinker igenom:

  1. FAKTA-VALIDERING: varje siffra, valuta, datum och sannolikt egennamn i den
     genererade texten måste återfinnas i källdatan. Annars → avvisa (troligen påhittat).
  2. FÖRBJUDET INNEHÅLL: matcha mot editorial.never_publish (jail/arrest/mugshot/
     obituary/anklagelser mot namngivna privatpersoner) → avvisa oavsett fakta.
  3. ÅSIKT: lätt heuristik mot åsiktsmarkörer i civik-sammanhang → flagga.

Filosofi: hellre falskt avvisa och falla tillbaka på ren mall än publicera en
uppdiktad uppgift. För jail/court gällde detta juridiskt; här gäller det trovärdighet.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


@dataclass
class GuardrailResult:
    passed: bool
    violations: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.passed


# --- tokenisering / normalisering ------------------------------------------

_NUM_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?%?")
# sannolika egennamn: sekvenser av Stor-inledda ord (evt. med & och bindestreck)
_PROPER_RE = re.compile(r"\b([A-Z][a-zA-Z.&'-]+(?:\s+[A-Z][a-zA-Z.&'-]+){0,4})\b")

# vanliga ord som råkar bli Stor-inledda i satsstart — vitlista, inte "namn"
_STOPWORDS = {
    "The", "A", "An", "This", "That", "These", "Those", "It", "They", "We", "You",
    "In", "On", "At", "For", "With", "And", "But", "Or", "If", "When", "Where",
    "Today", "Tomorrow", "Tonight", "This Week", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March",
    "April", "May", "June", "July", "August", "September", "October", "November",
    "December", "Brookings", "Brookings View", "South Dakota", "SD",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = s.replace(",", "").replace("$", "").replace("%", "")
    return s.casefold().strip()


_TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})(?::\d{2})?\b")


def _time_variants(source_text: str) -> str:
    """Källfält lagrar ofta tid som 24-timmars ISO-stämplar ("17:00:00"), men
    en varm/läsbar text skriver naturligt "5 PM" -- annars flaggas varje
    korrekt tidsomvandling som en påhittad siffra. Lägg till 12-timmarsvarianter
    i haystacken så båda skrivsätten räknas som samma, verifierade fakta."""
    extra: list[str] = []
    for h_str, m_str in _TIME_RE.findall(source_text):
        h = int(h_str)
        if not (0 <= h <= 23):
            continue
        period = "am" if h < 12 else "pm"
        h12 = h % 12 or 12
        extra += [str(h12), f"{h12}:{m_str}", f"{h12} {period}", f"{h12}:{m_str} {period}"]
    return " ".join(extra)


def _source_haystack(source_text: str) -> str:
    return _norm(source_text + " " + _time_variants(source_text))


def _numbers(text: str) -> set[str]:
    return {_norm(m.group()) for m in _NUM_RE.finditer(text)}


_LEADING_ARTICLES = {"The", "A", "An"}
_FUNCTION_WORDS = {
    "the", "a", "an", "of", "and", "for", "in", "on", "at", "to", "by",
    # generiska civik-/institutionsord: dessa är beskrivande brus runt den
    # faktiska särskiljande delen (ortnamnet), inte i sig en påhittningsbar
    # detalj -- annars underkänns t.ex. "Brookings Public Library" så fort
    # "Public"/"Library" saknas ord-för-ord i just den postens rådata, trots
    # att ortnamnet ("Brookings") är verifierat.
    "public", "library", "city", "county", "school", "district",
    "department", "council", "board", "center", "commission",
}

# meningen som helhet (inte bara position 0) avgör om en match är
# meningsinledande -- se _proper_nouns.
_SENTENCE_BOUNDARY_RE = re.compile(r"[.!?]\s+$|^\s*$")


def _proper_nouns(text: str) -> set[str]:
    out = set()
    for m in _PROPER_RE.finditer(text):
        # meningsinledande stor bokstav är grammatik, inte ett tecken på ett
        # egennamn -- ENGELSKA (och svenska) capitaliserar alltid första ordet
        # i en mening oavsett ordklass ("Registration runs..."). Att vitlista
        # varje tänkbart meningsinledande ord är en förlorad strid; hoppa
        # istället över meningsinledande matcher helt. Riktiga påhittade namn
        # fångas ändå eftersom de nästan alltid även förekommer mitt i text.
        if _SENTENCE_BOUNDARY_RE.search(text[:m.start()]):
            continue

        phrase = m.group(1).strip()
        # ordklassen tillåter punkt inuti ord (för förkortningar som "U.S."),
        # vilket kan råka limma ihop slutet av en mening med nästa mening --
        # t.ex. "...from 5-6 PM. Teens can..." matchar som "PM. Teens". Behåll
        # bara delen FÖRE en sådan intern meningsgräns.
        phrase = re.split(r"(?<=[.!?])\s+", phrase, maxsplit=1)[0].rstrip(".")

        words = phrase.split()
        # strippa ledande artikel ("The City Council" -> "City Council")
        while words and words[0] in _LEADING_ARTICLES:
            words = words[1:]
        if not words:
            continue
        phrase = " ".join(words)
        if phrase in _STOPWORDS:
            continue
        if len(words) == 1 and words[0] in _STOPWORDS:
            continue
        out.add(phrase)
    return out


# --- huvud-API --------------------------------------------------------------

def validate(generated_text: str, source_text: str, cfg: dict) -> GuardrailResult:
    """Validera genererad text mot källdatan + redaktionella regler."""
    violations: list[str] = []

    # 2. förbjudet innehåll först (billigast, hårdast)
    banned = _banned_hits(generated_text, cfg)
    if banned:
        violations.append(f"förbjudet innehåll: {', '.join(banned)}")

    # town/state/county namns nämns explicit i systemprompten (build_system_prompt),
    # så modellen VET dem legitimt -- de är inte hallucination bara för att de saknas
    # i just denna posts egen source_text. Utan detta skulle nästan varje blurb om en
    # hyperlokal nyhetssajt (som oundvikligen nämner ortens namn) falskt avvisas.
    known_context = " ".join(str(v) for v in (
        cfg.get("display_name"), cfg.get("state"), cfg.get("county"),
    ) if v)
    haystack = _source_haystack(source_text + " " + known_context)

    # 1a. siffror måste finnas i källan
    for num in _numbers(generated_text):
        if num and num not in haystack:
            violations.append(f"siffra saknas i källa: {num}")

    # 1b. sannolika egennamn måste finnas i källan
    for name in _proper_nouns(generated_text):
        if _norm(name) not in haystack:
            # tillåt om varje meningsbärande ord i namnet finns (ignorera funktionsord)
            words = [_norm(w) for w in name.split() if _norm(w) not in _FUNCTION_WORDS]
            if not all(w in haystack for w in words):
                violations.append(f"namn/entitet saknas i källa: {name}")

    # 3. åsiktsmarkörer (flagga, avvisa inte hårt för icke-civik)
    opinion = _opinion_hits(generated_text)
    if opinion:
        violations.append(f"möjlig åsikt/vinkling: {', '.join(opinion)}")

    return GuardrailResult(passed=len(violations) == 0, violations=violations)


def _banned_hits(text: str, cfg: dict) -> list[str]:
    """Matcha mot editorial.never_publish + hårdkodade skyddsord."""
    low = text.casefold()
    hard = ["mugshot", "arrest", "arrested", "booked into", "jail", "inmate",
            "obituary", "charged with", "indicted", "sex offender"]
    configured = []
    for item in cfg.get("editorial", {}).get("never_publish", []):
        # plocka nyckelord ur de svenska beskrivningarna
        for kw in re.findall(r"[a-zA-Z]{4,}", item):
            configured.append(kw.casefold())
    hits = []
    for kw in set(hard) | set(configured):
        if kw in low:
            hits.append(kw)
    return sorted(set(hits))


_OPINION_MARKERS = [
    "should", "shouldn't", "must ", "outrageous", "disgraceful", "wisely",
    "unfortunately", "sadly", "thankfully", "controversial", "failed to",
    "refused to", "shocking", "disappointing",
]


def _opinion_hits(text: str) -> list[str]:
    low = text.casefold()
    return [m.strip() for m in _OPINION_MARKERS if m in low]


# bekväm sträng-serialisering av källfält för validering
def source_to_text(record: dict) -> str:
    """Platta ut en DB-post/raw_data till en textmassa guardrails kan söka i."""
    parts: list[str] = []

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)
        elif v is not None:
            parts.append(str(v))

    walk(record)
    return " ".join(parts)
