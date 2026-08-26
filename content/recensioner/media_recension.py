"""Film-/TV-recension. Se PLAN.md (Innehållsspår v1, Steg 3), CONTENT_MODULES.md
och NEEDS-HUMAN-REVIEW.md "Review Writing Standard" (2026-08-23 rewrite --
tidigare version instruerade modellen att ALDRIG namnge en lokal biograf,
vilket blev fel så snart site-config.ts fick verifierad localTheaters-data
i Fas 3.3; se den sektionen för bakgrunden).

Enda modulen med ett numeriskt betyg. Modellen instrueras att avsluta med en
egen rad ("Betyg: X/5"), som plockas ut och strippas ur brödtexten här.
Hittas ingen sådan rad publiceras recensionen ändå utan betyg -- en saknad
siffra är inte ett skäl att blockera en i övrigt godkänd recension, samma
icke-blockerande hållning som bildgenereringen i Steg 3.5.

"Facts verified as of <date>" (Review Writing Standard non-negotiable #5)
läggs till av KOD, inte av modellen -- en dagens-datum-rad är inte något en
LLM ska pålitas att skriva korrekt, samma "verifiera, hitta inte på"-princip
som resten av huset. Den löpande "AI-generated"-bylinen sajten redan visar
på varje sida (se ai_pipeline/daily_content.py's INSERT, byline='AI-generated')
täcker disclosure-delen; den här raden är specifikt för recensionens EGNA
sakuppgifter (release, rollista, speltid), inte en andra kopia av bylinen.
"""
from __future__ import annotations

import calendar
import datetime
import re
import sys
from dataclasses import replace

from content._base import GeneratedArticle, generate_article, town_label
from content.recensioner import review_standard

CATEGORY = "Review"

SYSTEM_PROMPT_TEMPLATE = """Du skriver en recension av film eller TV för en lokal nyhetssajt som riktar sig till {town}, och regionen kring den. Tonen är den kunniga men tillgängliga grannen: någon som faktiskt sett filmen (i den meningen att omdömet är genomtänkt och konkret, INTE ett påstående om fysisk närvaro i en biosalong) och berättar rakt vad hen tycker -- varm, vardagsspråklig, säker nog att fälla ett omdöme men aldrig överlägsen.

STRUKTUR (i den här ordningen):
1. RUBRIK -- ämnet + den lokala kroken (t.ex. "...och {town} kan se den redan i helgen"), inte en generisk filmrubrik.
2. ÖPPNING -- varför en läsare i {town} bryr sig just NU (aktuell premiär, säsong, geografisk närhet). Det första stycket ska INTE fungera lika bra på vilken sajt som helst -- det ska vara skrivet FÖR den här läsaren.
3. VINKELN -- den riktiga historien: bakgrund, kontext, vad som gör just det här verket värt 600 ord, INTE en genomgång av handlingen. Om underlaget innehåller en påtaglig bakgrundshistoria (produktionsdrama, lång startsträcka, kontrovers), använd den som ingång.
4. PREMISS -- EN kompakt sektion om vad filmen/serien handlar om, utan att avslöja handlingens vändningar. Inte huvuddelen av texten.
5. OMDÖMET -- den ärliga, bärande delen. Om du fått verkliga sammanställda kritikersiffror i underlaget (Rotten Tomatoes/Metacritic/liknande), återge mottagandet ärligt utifrån DEM -- är siffrorna delade (t.ex. hög Tomatometer men lägre Metascore) så säg det, väg det. Hitta ALDRIG på en namngiven kritiker, en publikation eller ett citat du inte fått i underlaget -- attribuera bara till aggregatorns namn ("enligt Rotten Tomatoes..."). Landa sedan i ETT eget, tydligt vägt omdöme -- inte "kritikerna är delade" som en flykt från att ta ställning. En recension som vägrar döma är ingen recension.
6. NÄR UNDERLAGET INNEHÅLLER VERKLIGA LOKALA BIOGRAFER: väv naturligt in det exakta namnet på minst en av dem EN gång i texten (t.ex. "...visas nu på [biografens namn ur underlaget]"). Adress och telefonnummer visas separat av sajten -- du behöver inte återge dem. Hitta ALDRIG på en biograf som inte finns i underlaget.

STIL:
- 500-800 ord.
- Inga em-streck (—). Medvetet stilval.
- Konkret och specifik. Undvik recensionsklichéer ("en berg-och-dalbana av känslor").
- Tredje person, utom det egna omdömet i sektion 5 som får vara en tydlig, ägd bedömning.

INPUT: Du får titel, ett sammandrag, ev. verkliga sammanställda kritikersiffror, och ev. verkliga lokala biografer. Skriv en ärlig, välgrundad recension byggd på precis detta underlag -- hitta aldrig på fakta, kritiker, citat eller platser som inte finns där."""

_RATING_INSTRUCTION = (
    "\n\nAvsluta artikeln med en egen sista rad, exakt formaterad: \"Betyg: X/5\" "
    "(X är en siffra mellan 1 och 5, heltal eller halvtal, t.ex. 3.5). Ingen annan text på den raden."
)

_RATING_LINE_RE = re.compile(r"\n?\s*Betyg:\s*([\d.,]+)\s*/\s*5\s*$", re.IGNORECASE)


def _extract_rating(article: GeneratedArticle) -> GeneratedArticle:
    match = _RATING_LINE_RE.search(article.body)
    if not match:
        return article  # ingen betygsrad hittad -- publicera ändå, rating förblir None
    try:
        rating = float(match.group(1).replace(",", "."))
    except ValueError:
        return article
    body = _RATING_LINE_RE.sub("", article.body).strip()
    return replace(article, body=body, rating=rating)


def _append_verification_line(article: GeneratedArticle) -> GeneratedArticle:
    # calendar.month_name[...] instead of strftime("%-d") -- that flag is a
    # glibc-only extension that throws ValueError on Windows (see
    # ai_pipeline/meeting_followups.py for the same fix, hit live locally).
    today = datetime.date.today()
    label = f"{calendar.month_name[today.month]} {today.day}, {today.year}"
    body = f"{article.body}\n\nFacts verified as of {label}."
    return replace(article, body=body)


def _retry_addendum(violations: list[str]) -> str:
    bullets = "\n".join(f"- {v}" for v in violations)
    return (
        "\n\nIMPORTANT CORRECTION: your previous draft did not meet this site's "
        f"review standard:\n{bullets}\n"
        "Rewrite it to fix these specifically, keeping everything else that was "
        "already working. Do not invent facts, critics, quotes, or venues to "
        "satisfy this -- if the real reception genuinely isn't divided, or no "
        "verified venue was given, do the best honest version rather than "
        "fabricating."
    )


def write(local_input: str, existing_corpus: list[str], cfg: dict | None = None,
          client=None) -> GeneratedArticle | None:
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(town=town_label(cfg))
    venue_names = [t["name"] for t in (cfg or {}).get("local_theaters", [])]
    has_review_scores = "Real aggregate critic-reception scores" in local_input

    article = generate_article(system_prompt + _RATING_INSTRUCTION, local_input,
                                existing_corpus, cfg=cfg, client=client,
                                content_type="media_recension")
    if article is None:
        return None
    article = _extract_rating(article)

    check = review_standard.check_review_standard(
        article.title, article.body, cfg, venue_names, has_review_scores)
    if check.passed:
        return _append_verification_line(article)

    print(f"  review standard unmet ({'; '.join(check.violations)}) -- retrying once",
          file=sys.stderr)
    retry_article = generate_article(
        system_prompt + _RATING_INSTRUCTION + _retry_addendum(check.violations),
        local_input, existing_corpus, cfg=cfg, client=client,
        content_type="media_recension",
    )
    if retry_article is None:
        # Keep the first draft rather than lose a whole review to a transient
        # API hiccup on the retry call -- flag it for a human instead of
        # silently killing it (see review_standard.py's module docstring).
        return _append_verification_line(replace(article, review_flags=check.violations))

    retry_article = _extract_rating(retry_article)
    recheck = review_standard.check_review_standard(
        retry_article.title, retry_article.body, cfg, venue_names, has_review_scores)
    if not recheck.passed:
        print(f"  review standard still unmet after retry ({'; '.join(recheck.violations)}) "
              "-- publishing flagged for human review", file=sys.stderr)
        return _append_verification_line(replace(retry_article, review_flags=recheck.violations))
    return _append_verification_line(retry_article)
