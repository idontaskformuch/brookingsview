"""Bygger lokalt underlag för krönike-/ledarmodulerna ur redan skrapad, publicerad
och guardrail-godkänd data i `stories`.

Varför inte ett påhittat scenario: en krönika/ledare ska ha en anledning att
existera just den här veckan (se CONTENT_MODULES.md), och grundas i något som
faktiskt hänt på orten, inte i ett plausibelt låtande men overifierat
scenario. `stories`-raderna för meeting/event har redan passerat
ai_pipeline.guardrails extraktiva validering, så de är ett säkert substrat att
bygga vidare på.

TEMATISK REPETITION (2026-08-23, se NEEDS-HUMAN-REVIEW.md "Columns thematic
repetition"): en riktig, live-verifierad bugg -- Brookings City Council
publicerar en kvorumnotis (öppna-möten-lagens krav när fyra+ ledamöter
plausibelt kan befinna sig på samma plats) nästan ORDAGRANT varje vecka hela
sommaren (Downtown at Sundown, 5+ separata meeting-rader plus 3+ separata
event-rader för samma återkommande festival). Eftersom recent_local_stories()
bara plockade de 15 senaste meeting/event-raderna oavsett innehåll, dominerade
den återkommande notisen ofta majoriteten av den pool modellen fick välja
"EN vinkel" ur -- vilket ledde till att kolumner om exakt samma kvorumnotis-
tes publicerades upprepade gånger (bekräftat: "A Quorum on Main Avenue" och
"The Quorum at Sundown" gör samma Arendt-adjacenta poäng med nästan identisk
uppräkning av datum, ~en vecka isär).

TVÅ KOMPLETTERANDE FIXAR, ingen AI-baserad domändetektering (samma
deterministiska filosofi som is_closure()/_filter_reason() på andra ställen
i kodbasen):
  1. _collapse_recurring() slår ihop igenkända återkommande notismönster
     (kvorumnotiser specifikt, det enda mönstret som faktiskt observerats
     upprepa sig) till högst EN representant per körning, så en enskild
     återkommande händelse inte äter upp hela poolen.
  2. build_local_input() tar nu även emot en lista redan publicerade
     kolumnrubriker (senaste ~30 dagarna, alla fyra kolumntyper) och
     instruerar modellen explicit att INTE återanvända samma underliggande
     tes/vinkel som någon av dem, även med annan formulering -- det här är
     PROAKTIV styrning, till skillnad från guardrails.originality_check.is_original()
     (som bara fångar nästan-ordagranna omskrivningar i EFTERHAND, inte en
     tematisk upprepning med helt annan text -- verifierat att den metoden
     INTE skulle ha fångat detta fall, se dess egen docstring om
     tecken-baserad likhet).
"""
from __future__ import annotations

import re

from psycopg.rows import dict_row

LOOKBACK_DAYS = 14
MAX_ITEMS = 15
# Hämtas i en större rå-pool än MAX_ITEMS, eftersom _collapse_recurring()
# tar bort rader INNAN den slutgiltiga poolen trunkeras -- annars skulle en
# återkommande notis kunna tränga undan riktig variation redan i SQL-frågan.
_RAW_FETCH_LIMIT = 60

COLUMN_SOURCE_TYPES = ("culture_essay", "editorial", "kvick_essa", "vetenskap_kronika")
RECENT_TITLES_LOOKBACK_DAYS = 30

# Frasmönster som återkommer nästan ordagrant i varje kvorumnotis, oavsett
# vilket evenemang den gäller (Downtown at Sundown, Meet State, en BBQ, ett
# spontant möte vid brandstationen) -- verifierat mot verkliga rader i
# stories (meeting-1313/1314/1315/2428/4094/10812, event-258189/258205/258213).
# Det enda återkommande-mönstret som faktiskt observerats orsaka upprepning;
# inte en generell "låter tråkigt"-detektor.
_QUORUM_NOTICE_RE = re.compile(
    r"no official (?:city )?business will be (?:conducted|discussed)"
    r"|quorum notice"
    r"|may (?:attend|be present|gather)",
    re.IGNORECASE,
)


def _topic_key(story: dict) -> str | None:
    """Grov dedup-nyckel för igenkända återkommande notismönster. None =
    ingen känd återkommande kategori, raden behandlas som unik."""
    if _QUORUM_NOTICE_RE.search(story["title"]) or _QUORUM_NOTICE_RE.search(story["body"]):
        return "quorum_notice"
    return None


def _collapse_recurring(stories: list[dict], max_per_topic: int = 1) -> list[dict]:
    """Behåll högst `max_per_topic` instanser per igenkänd återkommande-
    notis-kategori (stories kommer i DESC published_at-ordning, så den
    behållna instansen är alltid den senaste). Rader utan känd kategori
    passerar oförändrat."""
    seen_counts: dict[str, int] = {}
    out = []
    for s in stories:
        key = _topic_key(s)
        if key is None:
            out.append(s)
            continue
        seen_counts[key] = seen_counts.get(key, 0) + 1
        if seen_counts[key] <= max_per_topic:
            out.append(s)
    return out


def recent_local_stories(conn, town_id: str, lookback_days: int = LOOKBACK_DAYS,
                          limit: int = MAX_ITEMS) -> list[dict]:
    """Real, already-published meeting/event stories from the last N days,
    med återkommande notismönster hopslagna (se moduldocstring)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT title, body, source_type, published_at
              FROM stories
             WHERE town_id = %s
               AND source_type IN ('meeting', 'event')
               AND published_at >= now() - make_interval(days => %s)
             ORDER BY published_at DESC
             LIMIT %s
            """,
            (town_id, lookback_days, _RAW_FETCH_LIMIT),
        )
        raw = cur.fetchall()
    return _collapse_recurring(raw)[:limit]


def recent_column_titles(conn, town_id: str, lookback_days: int = RECENT_TITLES_LOOKBACK_DAYS) -> list[str]:
    """Titlar på nyligen publicerade kolumner (alla fyra typer), för att
    styra bort en ny kolumn från att återanvända samma tes/vinkel -- se
    moduldocstring. Bara titlar, inte hela texten: räcker för modellen att
    undvika samma ÄMNE, och håller prompten kort."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT title FROM stories
             WHERE town_id = %s
               AND source_type = ANY(%s)
               AND published_at >= now() - make_interval(days => %s)
             ORDER BY published_at DESC
            """,
            (town_id, list(COLUMN_SOURCE_TYPES), lookback_days),
        )
        return [row[0] for row in cur.fetchall()]


def build_local_input(stories: list[dict], town: str, recent_titles: list[str] | None = None) -> str | None:
    """Format recent stories into a single underlag block for the AI prompt.

    Returns None if there is nothing to build from -- callers should skip
    generation for today rather than fall back to an invented premise.
    """
    if not stories:
        return None
    lines = [
        f"UNDERLAG: det senaste från {town} (redan publicerat "
        "och faktakontrollerat). Välj EN vinkel eller tes ur det som följer, "
        "väv inte in allt:",
        "",
    ]
    for s in stories:
        lines.append(f"- {s['title']}: {s['body']}")

    if recent_titles:
        lines += [
            "",
            "REDAN TÄCKT (senaste veckorna) -- välj INTE samma underliggande "
            "tes/vinkel som någon av dessa, även med andra ord eller ett annat "
            "specifikt exempel. Om underlaget ovan mest liknar ett ämne som "
            "redan täckts, hitta en genuint annan vinkel i underlaget i stället "
            "för att skriva ännu en variant:",
        ]
        lines += [f"- {t}" for t in recent_titles]

    return "\n".join(lines)
