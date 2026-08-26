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



# (\w) missade possessiv direkt efter en punkt-förkortning ("Skechers
# U.S.A.'s Moreno Valley" -- tecknet före 's är en punkt, inte \w), vilket
# fick Worker Pulse-digesten att avvisa varje omnämning av "Skechers U.S.A."
# eftersom den possessiva formen aldrig normaliserades bort. [.\w] täcker
# båda fallen.
_POSSESSIVE_RE = re.compile(r"([.\w])['’]s\b")
# Pluralpossessiv utan efterföljande "s" ("Deckers Brands' Moreno Valley")
# fångas inte av _POSSESSIVE_RE ovan (inget "s" efter apostrofen) -- samma
# upptäckt (2026-08, Worker Pulse-livetest). (?!\w) säkerställer att detta
# bara träffar en apostrof i ordslutet, aldrig mitt i en kontraktion som
# "don't".
_TRAILING_APOSTROPHE_RE = re.compile(r"([.\w])['’](?!\w)")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = s.replace(",", "").replace("$", "").replace("%", "")
    # possessiv-'s läggs ofta till/tas bort när AI:n skriver om en mening ("...the
    # U.S. Department of Transportation)" -> "Transportation's Build America Bureau")
    # utan att sakinnehållet ändras -- strippa den innan jämförelse.
    s = _POSSESSIVE_RE.sub(r"\1", s)
    s = _TRAILING_APOSTROPHE_RE.sub(r"\1", s)
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


# USPS-stil adressförkortningar. Källor skriver ofta "22nd Ave. S.", en varm
# omskrivning skriver naturligt ut det som "22nd Avenue South" -- samma adress,
# men guardrails textmatchning känner inte igen förkortning och fullform som
# samma sak. Ensiffriga väderstreck (N/S/E/W) är riskabla att blint expandera
# överallt, men eftersom vi bara LÄGGER TILL fullformer i haystacken (aldrig tar
# bort något) är felkostnaden låg -- värsta fallet är att haystacken blir något
# mer tillåtande, vilket bara minskar antalet falska avslag.
_ADDRESS_ABBR = {
    "ave": "avenue", "st": "street", "rd": "road", "dr": "drive",
    "blvd": "boulevard", "ln": "lane", "ct": "court", "pl": "place",
    "hwy": "highway", "cir": "circle", "pkwy": "parkway",
    "n": "north", "s": "south", "e": "east", "w": "west",
}
_ADDR_ABBR_RE = re.compile(
    r"\b(" + "|".join(_ADDRESS_ABBR) + r")\b\.?", re.IGNORECASE
)


def _address_variants(source_text: str) -> str:
    return " ".join(
        _ADDRESS_ABBR[m.group(1).lower()] for m in _ADDR_ABBR_RE.finditer(source_text)
    )


_CAPWORD_SEQ_RE = re.compile(r"\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){1,4})\b")


def _compound_variants(source_text: str) -> str:
    """Källor och en varm omskrivning kan sär- eller hopskriva samma namn olika
    ("Next Era Energy" i agendan vs det officiella "NextEra Energy"). Lägg till
    hopskrivna varianter av intilliggande versalordspar som bonus-tokens --
    räcker för att per-ord-fallbacken i validate() ska hitta båda formerna,
    utan att behöva slå ihop hela haystacken (för riskabelt: skulle kunna limma
    ihop ord från helt orelaterade meningar till en falsk träff)."""
    extra: list[str] = []
    for m in _CAPWORD_SEQ_RE.finditer(source_text):
        words = m.group(1).split()
        for i in range(len(words) - 1):
            extra.append(words[i] + words[i + 1])
    return " ".join(extra)


def _source_haystack(source_text: str) -> str:
    return _norm(
        source_text + " " + _time_variants(source_text) + " "
        + _address_variants(source_text) + " " + _compound_variants(source_text)
    )


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


def _is_spelled_out_acronym(phrase: str, haystack: str) -> bool:
    """Är `phrase` en utskriven akronym som förekommer FÖRKORTAD i källan?

    Civik-text är full av förkortningar ("PSAP", "HRC", "ADA") som en varm
    formulering naturligt skriver ut ("Public Safety Answering Point"). Det är
    samma sakinnehåll, inte en hallucination -- men textmatchning känner inte
    igen förkortning och fullform som samma sak. Generellt (självuppdaterande,
    ingen hårdkodad ordlista): ta initialerna ur frasen och kolla om DE
    förekommer som ett fristående ord i källan. Kräver minst 3 bokstäver för
    att hålla nere risken för att råka matcha en slumpartad 2-bokstavsbit.
    """
    words = [w for w in phrase.split() if w and w[0].isalpha()]
    if len(words) < 2:
        return False
    initials = "".join(w[0] for w in words).lower()
    if len(initials) < 3:
        return False
    return re.search(rf"\b{re.escape(initials)}\b", haystack) is not None


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
            if not all(w in haystack for w in words) and not _is_spelled_out_acronym(name, haystack):
                violations.append(f"namn/entitet saknas i källa: {name}")

    # 3. åsiktsmarkörer (flagga, avvisa inte hårt för icke-civik)
    opinion = _opinion_hits(generated_text)
    if opinion:
        violations.append(f"möjlig åsikt/vinkling: {', '.join(opinion)}")

    return GuardrailResult(passed=len(violations) == 0, violations=violations)


# --- employer-hedging (Worker Pulse / Workplace Watch) ----------------------

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# Maskeringstecken för punkter INUTI ett spårat arbetsgivarnamn ("Skechers
# U.S.A.") innan meningsdelning -- annars tolkas namnets egna punkter som
# meningsgränser och en mening kapas mitt i ("Employees at the Skechers
# U.S.A." blir en egen "mening" utan verb, alltid ohedgad). Samma klass av
# problem som _proper_nouns() ovan löser för "PM. Teens", fast här känner vi
# namnet i förväg så vi kan maskera det specifikt i stället för att gissa.
_ABBREV_PLACEHOLDER = "§"

# Live-testad 2026-08 mot riktiga Brave-träffar: en fast fraslista
# ("reviews mention", "employees describe", ...) missade nästan alla
# naturliga omskrivningar (t.ex. "Employees ... give the company a 3.2",
# "Reviews ... show mixed sentiment") och fällde varenda digest till
# mall-fallback. Ord-baserad matchning i stället: en mening som nämner
# arbetsgivaren måste innehålla BÅDE ett käll-ord (review/employee/...) OCH
# ett omdömesverb (mention/describe/show/...) någonstans i meningen -- mer
# permissivt än en exakt fras, men fångar fortfarande en bar, ohedgad
# påstående-mening som "ALDI is understaffed." (varken käll-ord eller verb).
_REVIEW_SOURCE_WORDS = {
    "review", "reviews", "reviewer", "reviewers", "employee", "employees",
    "worker", "workers", "staff", "glassdoor", "indeed",
}
_ATTRIBUTION_VERBS = {
    "mention", "mentions", "mentioned", "describe", "describes", "described",
    "note", "notes", "noted", "report", "reports", "reported", "say", "says",
    "said", "cite", "cites", "cited", "indicate", "indicates", "indicated",
    "suggest", "suggests", "give", "gives", "rate", "rates", "rated",
    "recommend", "recommends", "according", "show", "shows", "reflect",
    "reflects", "highlight", "highlights", "point", "points", "describe",
}


def validate_employer_hedging(text: str, employer_names: list[str]) -> GuardrailResult:
    """Varje mening som nämner en spårad arbetsgivare måste förbehålla sitt
    påstående (ett käll-ord + ett omdömesverb, se ovan) snarare än påstå det
    som etablerat faktum. Namngivna FÖRETAG är på riktigt här -- viktigare än
    för recept/evenemang. Se ai_pipeline/workplace_watch_digest.py.

    Snävt avgränsad: anropas bara av workplace_watch_digest.py, UTÖVER den
    vanliga faktakollen i validate() ovan -- rör inte beteendet för någon
    annan innehållstyp.
    """
    violations: list[str] = []
    low_names = [n.casefold() for n in employer_names if n]
    if not low_names:
        return GuardrailResult(passed=True)

    masked = text
    for name in employer_names:
        if name and "." in name:
            masked = masked.replace(name, name.replace(".", _ABBREV_PLACEHOLDER))

    for chunk in _SENTENCE_SPLIT_RE.split(masked):
        sentence = chunk.replace(_ABBREV_PLACEHOLDER, ".")
        low = sentence.casefold()
        if not any(name in low for name in low_names):
            continue
        words = set(re.findall(r"[a-z']+", low))
        if not (words & _REVIEW_SOURCE_WORDS and words & _ATTRIBUTION_VERBS):
            violations.append(f"unhedged employer claim: {sentence.strip()}")

    return GuardrailResult(passed=len(violations) == 0, violations=violations)


# Ord som skulle plockas ut av regexen nedan men som är för generiska/vanliga
# för att fungera som ett eget förbjudet nyckelord -- de råkar bara stå i en
# never_publish-beskrivning tillsammans med det faktiskt känsliga ordet
# (t.ex. "arrest / jail / booking data om namngivna personer": avsikten är att
# blockera bookingregister, inte ordet "data" i sig). Upptäckt när
# home_sales_digest.py:s legitima "assessor data" alltid föll tillbaka på
# mallen -- "data" är samma ord på engelska och svenska, så det slank med som
# ett skyddsord av misstag. Övriga ord i de svenska beskrivningarna är
# svenskspecifika (personer/namngivna/eller/endast) och riskerar aldrig samma
# falska träff eftersom AI-texten alltid skrivs på engelska.
_TOO_GENERIC_FOR_BANLIST = {"data"}


def _banned_hits(text: str, cfg: dict) -> list[str]:
    """Matcha mot editorial.never_publish + hårdkodade skyddsord."""
    low = text.casefold()
    hard = ["mugshot", "arrest", "arrested", "booked into", "jail", "inmate",
            "obituary", "charged with", "indicted", "sex offender"]
    configured = []
    for item in cfg.get("editorial", {}).get("never_publish", []):
        # plocka nyckelord ur de svenska beskrivningarna
        for kw in re.findall(r"[a-zA-Z]{4,}", item):
            kw = kw.casefold()
            if kw not in _TOO_GENERIC_FOR_BANLIST:
                configured.append(kw)
    hits = []
    for kw in set(hard) | set(configured):
        if kw in low:
            hits.append(kw)
    return sorted(set(hits))


_OPINION_MARKERS = [
    "shouldn't", "must ", "outrageous", "disgraceful", "wisely",
    "unfortunately", "sadly", "thankfully", "controversial", "failed to",
    "refused to", "shocking", "disappointing",
]
# Bare "should" was removed 2026-08-26: live-tested against real Moreno
# Valley meeting generation (scripts/eval_tone_v2.py), it false-positived on
# exactly the plain procedural instructions the new tone_v2 meeting prompt
# explicitly asks for ("Those wishing to testify should submit a speaker
# slip") -- a neutral instruction to the PUBLIC, not an opinion about what a
# civic body ought to do. "shouldn't" (kept) is a much stronger, rarer
# signal and wasn't implicated. This is a shared guardrail (validate() runs
# for every content type, not just tone_v2), so the fix benefits the
# content track too, not just meeting/event/alert.


def _opinion_hits(text: str) -> list[str]:
    low = text.casefold()
    return [m.strip() for m in _OPINION_MARKERS if m in low]


# --- Summary Tone Prompts (meeting/event/alert) -----------------------------
#
# See NEEDS-HUMAN-REVIEW.md "Summary Tone Prompts -- scraped local items" and
# ai_pipeline/format_prompt.py's build_system_prompt_v2(). These checks are
# ADDITIONAL to validate() above (still runs first -- fact/banned-content/
# opinion checks are type-agnostic and unaffected by tone). Gated behind
# cfg["ai"]["tone_v2"] in format_record(); doesn't touch the content track or
# any other guardrail path (validate_employer_hedging() included).

_BANNED_TONE_ADJECTIVES = {
    "long-awaited", "controversial", "exciting", "important", "significant",
    "much-anticipated", "key", "major", "popular", "beloved", "unique",
}
_BANNED_ADJECTIVE_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in _BANNED_TONE_ADJECTIVES) + r")\b",
    re.IGNORECASE,
)

_FORBIDDEN_OPENING_RE = re.compile(
    r"(?:^|[.!?]\s+)(This means|This comes as|The move)\b", re.IGNORECASE,
)


def _banned_adjective_hits(text: str) -> list[str]:
    return sorted({m.group(1).lower() for m in _BANNED_ADJECTIVE_RE.finditer(text)})


def _em_dash_hits(text: str) -> bool:
    return "—" in text  # em dash (—); commas/periods/parens only, see §2


def _forbidden_opening_hits(text: str) -> list[str]:
    return sorted({m.group(1) for m in _FORBIDDEN_OPENING_RE.finditer(text)})


# Coarse, regex-based opening-shape heuristic -- NOT real POS tagging (no NLP
# dependency exists in this codebase; see guardrails.py's module docstring
# philosophy of cheap heuristics over heavy machinery). Good enough for its
# actual job: telling "Subject + verb-of-occurrence" (the pattern the brief
# flags as the actual problem -- "The Planning Commission will hold...",
# "ABC's & 123's meets at...") apart from other openings, not a linguistically
# precise tagger.
_OCCURRENCE_VERBS = {
    "meets", "meet", "runs", "run", "holds", "hold", "will", "takes", "take",
    "hosts", "host", "opens", "open", "begins", "begin", "starts", "start",
    "features", "feature", "welcomes", "welcome",
}


def classify_opening(text: str) -> str:
    """A short label for a summary's opening shape, for the cross-item
    diversity check below. 'subject_verb' is the specific shape the brief's
    §1 calls out -- an optional leading article, then a capitalized
    (possibly multi-word) subject phrase, immediately followed by an
    occurrence verb: "The Planning Commission will...", "Discovery Club
    meets...". Everything else buckets more coarsely; still a heuristic,
    not real POS tagging (see the module comment above)."""
    words = re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*", text)[:8]
    if not words:
        return "other"

    idx = 0
    has_leading_article = words[0].lower() in ("a", "an", "the")
    if has_leading_article:
        idx = 1

    subject_end = idx
    while subject_end < len(words) and words[subject_end][:1].isupper():
        subject_end += 1

    if subject_end > idx and subject_end < len(words) and words[subject_end].lower() in _OCCURRENCE_VERBS:
        return "subject_verb"
    if has_leading_article:
        return "article"
    if len(words) >= 2 and words[1].endswith("ing"):
        return "gerund"
    if re.match(r"^\d", words[0]):
        return "number"
    return "other"


def opening_diversity_ok(shape: str, recent_shapes: list[str], threshold: float = 0.30) -> bool:
    """False if adding `shape` to `recent_shapes` would push that shape's
    share of the page above `threshold` -- see §7.5: "no more than 30% may
    open with the same first two part-of-speech pattern." `recent_shapes`
    is the caller's own proxy for "what's rendered on one page" (e.g. the
    last ~10 published same-source_type/town items) -- generation happens
    one record at a time, long before page composition is known, so an
    exact page-level check isn't possible at this point in the pipeline;
    see ai_pipeline/publish.py for how the proxy list is built."""
    if shape == "other":
        return True  # 'other' is deliberately not policed -- only the
        # named repetitive shapes are what the brief is actually about.
    combined = recent_shapes + [shape]
    share = combined.count(shape) / len(combined)
    return share <= threshold


def validate_tone_v2(
    summary: str, meta: dict, source_text: str, source_type: str, cfg: dict,
    *, has_venue_in_source: bool = False, has_when_in_source: bool = False,
    recent_openings: list[str] | None = None,
) -> GuardrailResult:
    """Post-generation checks specific to the {summary, meta} tone-v2 shape
    (§7). Runs IN ADDITION to validate(summary, source_text, cfg) -- callers
    must run both (see format_prompt.py's format_record())."""
    violations: list[str] = []

    # 1. required fields survived -- NOT applied to alerts. §5's own alert
    # rules explicitly want the practical shape (what/where/how long) INSIDE
    # the prose ("Lead with the practical shape"), unlike meeting/event
    # where §3/§4 explicitly move the time OUT of the prose and into meta.
    # Live-tested (2026-08-26): requiring meta.when for alerts too rejected
    # correct, on-brief alert summaries that stated the time window plainly
    # in the sentence exactly as instructed, just because meta.when wasn't
    # ALSO redundantly filled -- a real conflict between this check and the
    # alert-specific prompt rules, not a generation defect.
    if source_type != "alert":
        if has_when_in_source and not meta.get("when"):
            violations.append("tone_v2: source has a date/time but meta.when is missing")
        if has_venue_in_source and not meta.get("venue"):
            violations.append("tone_v2: source has a venue but meta.venue is missing")

    # 2. banned-adjective scan
    banned = _banned_adjective_hits(summary)
    if banned:
        violations.append(f"tone_v2: banned adjective(s): {', '.join(banned)}")

    # 3. no em dashes
    if _em_dash_hits(summary):
        violations.append("tone_v2: em dash used")

    # 4. no invented numbers -- meta values are extracted FROM the source by
    # the same generation call, so they count as legitimate haystack, not
    # just source_text (e.g. a phone number restated in meta.phone and
    # nowhere else verbatim in source_text due to formatting differences).
    meta_text = " ".join(str(v) for v in meta.values() if v is not None)
    haystack = _source_haystack(source_text + " " + meta_text)
    for num in _numbers(summary):
        if num and num not in haystack:
            violations.append(f"tone_v2: number not in source: {num}")

    # 5. opening-structure diversity
    if recent_openings is not None:
        shape = classify_opening(summary)
        if not opening_diversity_ok(shape, recent_openings):
            violations.append(f"tone_v2: opening shape '{shape}' over 30% of recent {source_type} items")

    # 6. length band per type -- see format_prompt.py's TONE_V2_LENGTH_SENTENCES
    # for the actual bounds (kept there, not duplicated here, since the bands
    # are prompt-authoring concerns co-located with the prompt text itself).
    from ai_pipeline.format_prompt import TONE_V2_MAX_SENTENCES
    max_sentences = TONE_V2_MAX_SENTENCES.get(source_type)
    if max_sentences is not None:
        sentence_count = len([s for s in _SENTENCE_SPLIT_RE.split(summary.strip()) if s])
        if sentence_count > max_sentences:
            violations.append(f"tone_v2: {sentence_count} sentences exceeds {source_type} ceiling of {max_sentences}")

    return GuardrailResult(passed=len(violations) == 0, violations=violations)


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
