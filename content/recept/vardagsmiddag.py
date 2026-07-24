"""Vardagsmiddagsrecept. Se PLAN.md (Innehållsspår v1, Steg 3) och CONTENT_MODULES.md.

Enda modulen där numrerad lista är rätt format (se STIL i systemprompten) -- det är
receptets naturliga struktur, till skillnad från krönikorna som uttryckligen undviker
listformat.

Ingredienserna bryts ut som en egen strukturerad lista (GeneratedArticle.ingredients)
i stället för att stå som löptext i body -- se INGREDIENSMARKÖRER nedan och
extract_marked_list() i content/_base.py. body innehåller därefter bara
förklarande text (inledning + numrerade instruktioner), precis som förut."""
from __future__ import annotations

from content._base import GeneratedArticle, extract_marked_list, generate_article

CATEGORY = "Recipe"

_INGREDIENTS_START = "<<<INGREDIENTS>>>"
_INGREDIENTS_END = "<<<END INGREDIENTS>>>"

SYSTEM_PROMPT = f"""Du skriver ett vardagsmiddagsrecept för en lokal nyhetssajt som riktar sig till Brookings, South Dakota, och regionen kring den. Tonen är praktisk, varm och pålitlig: en middag som faktiskt går att laga en vanlig vardagskväll.

FORMAT OCH RÖST:
- Skriv för verkligheten: begränsad tid, vanliga ingredienser, en trött kock. Fokus på genomförbarhet.
- Kort inledning som sätter rätten (varför den funkar en vardag, vad som gör den bra), sedan ingrediensblocket (se INGREDIENSMARKÖRER nedan), sedan stegvisa instruktioner.
- Var exakt med mängder och tider. Vaga recept är oanvändbara recept.
- Ange antal portioner. Använd ingredienser som rimligen finns i en vanlig mataffär i regionen. Notera enkla substitut där det är naturligt.

INGREDIENSMARKÖRER:
- Ingredienslistan ska stå för sig själv, omgiven av exakt dessa två markörrader (skriv dem exakt så här, oöversatta, en rad var för sig):
  {_INGREDIENTS_START}
  {_INGREDIENTS_END}
- Mellan markörerna: en ingrediens per rad, varje rad inledd med "- ", inklusive mängd (t.ex. "- 400 g kycklinglår, i bitar"). Inget annat på de raderna -- ingen rubrik, ingen extra text.
- Blocket placeras efter inledningen och före instruktionerna.

STIL:
- Inledning kort, max ett par stycken. Inga em-streck (—) i brödtexten. Medvetet stilval.
- Instruktionerna får vara i numrerad lista (det är rätt format för recept, till skillnad från krönikorna).
- Ingen svulstig matbloggar-preambel om barndomsminnen. Kom till saken.

INPUT: Du får ett rättkoncept eller en huvudingrediens. Din uppgift är att skriva ett genomförbart, gott vardagsrecept med exakta mängder och tydliga steg."""


def write(local_input: str, existing_corpus: list[str], cfg: dict | None = None,
          client=None) -> GeneratedArticle | None:
    article = generate_article(SYSTEM_PROMPT, local_input, existing_corpus, cfg=cfg, client=client)
    if article is None:
        return None

    ingredients, body = extract_marked_list(article.body, _INGREDIENTS_START, _INGREDIENTS_END)
    article.ingredients = ingredients or None
    article.body = body
    return article
