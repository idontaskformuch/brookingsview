# Spec: Glasgow Loop "Tonight", omgjord för kort attention span

STATUS: handoffen kom in AVKLIPPT (slutar mitt i punkt 4, "Gångtid = fågelv…"). Resten saknas och måste klistras om av ägaren innan något byggs.

## Mål
Samma data, ny presentation. Besökaren ska på 3 sekunder se att det händer mycket ikväll och hitta något att trycka på. Glasgow först, som mall för alla städer (per stad i config).

## Designprinciper
1. 3-sekundersregeln: överst syns antal, vad som börjar snart och en tydlig väg vidare. Ingen inledningstext.
2. Kort, inte rader. Varje event är ett tryckbart kort, hela kortet är länken.
3. Färg och form bär informationen. Kategori = accentfärg, status = badge.
4. Variation i rytm: blanda horisontella swipe-rader och korta vertikala listor. Inga långa likadana listor.
5. Ingen AI-prosa. Allt som visas är data: titel, venue, område, tid, pris, status, avstånd.
6. Inget göms för sökmotorer. Allt i HTML:en, swipe-rader är vanliga listor med overflow-x.

## Sidans ordning uppifrån och ner
1. Header: "Tonight in Glasgow" + stor siffra ("34 things on") + "Next up in 12 min" (live).
2. Starting soon: horisontell swipe-rad, max 6 stora kort med det som börjar inom 90 min eller pågår ("On now"). Störst typografi på sidan.
3. Områdes-chips, sticky under headern: All, Merchant City, West End, Finnieston, Southside, City Centre osv. (från datans `area`, per stad i config). Ett tryck filtrerar hela sidan client-side. Antal per chip ("West End 8").
4. Make a night of it: 3 kort som kopplar ett event till ett Open late-ställe inom ca 10 min promenad: "Othello · Citizens Theatre → Mango until 3am · 6 min walk". Bara när båda har koordinater. Gångtid = fågelv… [AVKLIPPT]
5+. [SAKNAS]
