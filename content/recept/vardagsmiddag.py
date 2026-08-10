"""Vardagsmiddagsrecept. Se PLAN.md (Innehållsspår v1, Steg 3) och CONTENT_MODULES.md.

Enda modulen där numrerad lista är rätt format (se STIL i systemprompten) -- det är
receptets naturliga struktur, till skillnad från krönikorna som uttryckligen undviker
listformat.

Ingredienser OCH instruktioner bryts ut som egna strukturerade listor
(GeneratedArticle.ingredients/instructions) i stället för att stå som löptext i
body -- se MARKÖRER nedan och extract_marked_list() i content/_base.py. body
innehåller efter extraktion bara inledningen, ren prosa.

FAIL-LOUD, INTE TYST FALLBACK (2026-08-08): en DB-granskning visade att 2 av 4
redan publicerade recept (50%) hade misslyckad markörextraktion -- modellen
följde inte alltid formatet, och hela receptet (ingredienser inklusive) hamnade
som en enda oformaterad textklump i body, publicerad utan att någon märkte det.
write() publicerar därför INTE ett recept vars extraktion misslyckas för
ingredienser ELLER instruktioner -- loggar tydligt och returnerar None (hoppar
över dagens publicering), samma "hellre ingen artikel idag än en trasig"-princip
som _base.py.generate_article() redan tillämpar för budgettak/originalitet.
Ingen mallfallback (jfr. home_sales_digest.py): ett recept har inget rimligt
deterministiskt mallinnehåll att falla tillbaka på, till skillnad från en
statistiksammanfattning."""
from __future__ import annotations

from content._base import GeneratedArticle, extract_marked_list, generate_article, town_label

CATEGORY = "Recipe"

_INGREDIENTS_START = "<<<INGREDIENTS>>>"
_INGREDIENTS_END = "<<<END INGREDIENTS>>>"
_INSTRUCTIONS_START = "<<<INSTRUCTIONS>>>"
_INSTRUCTIONS_END = "<<<END INSTRUCTIONS>>>"

# Inte en f-sträng: {town} måste fyllas i vid write()-anrop (town_label(cfg)
# behöver cfg, som inte finns på modulnivå), medan markörkonstanterna är rena
# modulkonstanter -- alla fylls i tillsammans via .format() i write() i stället
# för att blanda tidpunkter för interpolering.
SYSTEM_PROMPT_TEMPLATE = """Du skriver ett vardagsmiddagsrecept för en lokal nyhetssajt som riktar sig till {town}, och regionen kring den. Tonen är praktisk, varm och pålitlig: en middag som faktiskt går att laga en vanlig vardagskväll.

FORMAT OCH RÖST:
- Skriv för verkligheten: begränsad tid, vanliga ingredienser, en trött kock. Fokus på genomförbarhet.
- Ange antal portioner. Använd ingredienser som rimligen finns i en vanlig mataffär i regionen. Notera enkla substitut där det är naturligt.
- Var exakt med mängder och tider. Vaga recept är oanvändbara recept.

OBLIGATORISK STRUKTUR -- exakt tre delar, i denna ordning. Detta är inte valfritt:

1. INLEDNING (ren löptext, INGEN markör runt den, kommer först): 2-4 meningar som introducerar rätten (varför den passar en vardag, smak, ursprung eller liknande). Ingen svulstig matbloggar-preambel om barndomsminnen. Kom till saken.

2. INGREDIENSER, omgivna av EXAKT dessa två markörrader, ordagrant, oöversatta, var för sig på egen rad:
{ingredients_start}
{ingredients_end}
Mellan markörerna: en ingrediens per rad, VARJE rad börjar med "- " följt av mängd, enhet och ingrediens i den ordningen (t.ex. "- 400 g kycklinglår, i bitar", "- 2 vitlöksklyftor, finhackade", "- 1 dl grädde"). Ingredienser ska ALDRIG skrivas som löpande text i något annat stycke -- alltid en punkt per rad här, ingenting annat på raderna (ingen rubrik, inga kommentarer).

3. INSTRUKTIONER, omgivna av EXAKT dessa två markörrader, ordagrant, oöversatta, var för sig på egen rad:
{instructions_start}
{instructions_end}
Mellan markörerna: ett steg per rad, i kronologisk ordning, VARJE rad börjar med "- " (inte "1.", inte "Steg 1:" -- bara "- " följt av steget, sidan numrerar stegen själv). Ett sammanhängande handlingsmoment per rad, inte flera hopklumpade steg på samma rad.

Dessa fyra markörrader ({ingredients_start}, {ingredients_end}, {instructions_start}, {instructions_end}) MÅSTE finnas med exakt, en per egen rad, annars går receptet inte att publicera.

INPUT: Du får ett rättkoncept eller en huvudingrediens. Din uppgift är att skriva ett genomförbart, gott vardagsrecept med exakta mängder och tydliga steg."""


def write(local_input: str, existing_corpus: list[str], cfg: dict | None = None,
          client=None) -> GeneratedArticle | None:
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        town=town_label(cfg),
        ingredients_start=_INGREDIENTS_START, ingredients_end=_INGREDIENTS_END,
        instructions_start=_INSTRUCTIONS_START, instructions_end=_INSTRUCTIONS_END,
    )
    article = generate_article(system_prompt, local_input, existing_corpus, cfg=cfg, client=client,
                                content_type="vardagsmiddag")
    if article is None:
        return None

    ingredients, body = extract_marked_list(article.body, _INGREDIENTS_START, _INGREDIENTS_END)
    instructions, body = extract_marked_list(body, _INSTRUCTIONS_START, _INSTRUCTIONS_END)

    # FAIL-LOUD: se moduldocstring. En tom lista betyder att modellen inte
    # följde markörformatet -- publicera inte ett strukturlöst recept.
    problems = []
    if not ingredients:
        problems.append("inga ingredienser extraherade (markörer saknas/trasiga)")
    if not instructions:
        problems.append("inga instruktioner extraherade (markörer saknas/trasiga)")
    if problems:
        print(f"  vardagsmiddag: hoppar över publicering -- {', '.join(problems)}")
        return None

    article.ingredients = ingredients
    article.instructions = instructions
    article.body = body
    return article
