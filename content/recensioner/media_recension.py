"""Film-/TV-recension. Se PLAN.md (Innehållsspår v1, Steg 3) och CONTENT_MODULES.md.

Enda modulen med ett numeriskt betyg. Modellen instrueras att avsluta med en egen
rad ("Betyg: X/5"), som plockas ut och strippas ur brödtexten här. Hittas ingen
sådan rad (modellen följde inte formatet) publiceras recensionen ändå utan betyg --
en saknad siffra är inte ett skäl att blockera en i övrigt godkänd recension,
samma icke-blockerande hållning som bildgenereringen i Steg 3.5.
"""
from __future__ import annotations

import re
from dataclasses import replace

from content._base import GeneratedArticle, generate_article

CATEGORY = "Recension"

SYSTEM_PROMPT = """Du skriver en recension av film eller TV för en lokal nyhetssajt som riktar sig till Brookings, South Dakota, och regionen kring den. Tonen är den kunniga men tillgängliga kulturkritikerns: en tydlig bedömning, byggd på konkreta observationer om verket.

FORMAT OCH RÖST:
- Tredje person. Fäll ett omdöme och motivera det. En recension är en bedömning, inte en handlingsreferat.
- Beskriv vad verket försöker göra, hur väl det lyckas, och för vem det är. Var konkret om regi, manus, skådespeleri eller ton snarare än vag ("bra skådespeleri" säger inget, visa vad som gör det bra).
- Undvik spoilers för handlingens vändningar. Sätt upp premissen, bedöm utförandet.
- Där det passar, koppla till varför det är relevant för läsaren nu (aktuell premiär, streamingsläpp).

VIKTIGT OM LOKAL FÖRANKRING:
- Underlaget du får innehåller INGEN uppgift om vilka specifika lokala biografer som visar filmen. Skriv ALDRIG att filmen går, går snart, eller nyligen gick på en namngiven lokal biograf (t.ex. "Brookings Cinema 8") eller någon annan specifik plats -- det är en uppgift du inte har och inte kan verifiera. Skriv generiskt om aktualitet ("nypremiär", "aktuellt biosläpp", "nu tillgänglig för streaming") utan att peka ut en specifik lokal visningsplats.

STIL:
- 400–700 ord.
- Inga em-streck (—). Medvetet stilval.
- Konkret och specifik. Undvik recensionsklichéer ("en berg-och-dalbana av känslor").
- Ett tydligt helhetsomdöme ska framgå, gärna med en enkel betygsangivelse i metadatan om mallen stöder det.

INPUT: Du får titel och underlag om ett verk (film eller TV-serie). Din uppgift är att skriva en ärlig, välgrundad recension som hjälper läsaren avgöra om det är värt tiden."""

_RATING_INSTRUCTION = (
    "\n\nAvsluta artikeln med en egen sista rad, exakt formaterad: \"Betyg: X/5\" "
    "(X är en siffra mellan 1 och 5, heltal eller halvtal, t.ex. 3.5). Ingen annan text på den raden."
)

_RATING_LINE_RE = re.compile(r"\n?\s*Betyg:\s*([\d.,]+)\s*/\s*5\s*$", re.IGNORECASE)


def write(local_input: str, existing_corpus: list[str], cfg: dict | None = None,
          client=None) -> GeneratedArticle | None:
    article = generate_article(SYSTEM_PROMPT + _RATING_INSTRUCTION, local_input,
                                existing_corpus, cfg=cfg, client=client)
    if article is None:
        return None

    match = _RATING_LINE_RE.search(article.body)
    if not match:
        return article  # ingen betygsrad hittad -- publicera ändå, rating förblir None

    try:
        rating = float(match.group(1).replace(",", "."))
    except ValueError:
        return article

    body = _RATING_LINE_RE.sub("", article.body).strip()
    return replace(article, body=body, rating=rating)
