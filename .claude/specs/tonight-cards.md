# Handoff: Glasgow Loop "Tonight", omgjord för kort attention span

## Mål
Samma data, ny presentation. En besökare ska på 3 sekunder se att det händer mycket ikväll och hitta något att trycka på. Glasgow först, som mall för alla städer (per stad i config).

## Designprinciper (styr alla beslut)
1. **3-sekundersregeln:** överst syns antal, vad som börjar snart och en tydlig väg vidare. Ingen inledningstext.
2. **Kort, inte rader.** Varje event är ett tryckbart kort. Hela kortet är länken.
3. **Färg och form bär informationen.** Kategori = accentfärg, status = badge. Ingen behöver läsa för att sortera.
4. **Variation i rytm.** Blanda horisontella swipe-rader och korta vertikala listor. Inga långa likadana listor.
5. **Ingen AI-prosa.** Allt som visas är data: titel, venue, område, tid, pris, status, avstånd.
6. **Inget innehåll göms för sökmotorer.** Allt finns i HTML:en, och swipe-rader är vanliga listor med overflow-x.

## Sidans ordning uppifrån och ner
1. **Header:** "Tonight in Glasgow" + stor siffra ("34 things on") + "Next up in 12 min" (live).
2. **Starting soon:** horisontell swipe-rad, max 6 stora kort med det som börjar inom 90 min eller pågår ("On now"). Störst typografi på sidan.
3. **Områdes-chips, sticky under headern:** All, Merchant City, West End, Finnieston, Southside, City Centre osv. (från datans `area`, per stad i config). Ett tryck filtrerar hela sidan client-side. Antal per chip ("West End 8").
4. **Make a night of it:** 3 kort som kopplar ett event till ett Open late-ställe inom ca 10 min promenad: "Othello · Citizens Theatre → Mango until 3am · 6 min walk". Bara när båda har koordinater. Gångtid = fågelvägsavstånd × 1,3 / 80 m per min, märkt "approx".
5. **Kategorirader:** Live music, Comedy & shows, Theatre, Also on. Varje rad är en swipe-rad med rubrik, antal och "See all" som fäller ut en vertikal lista.
6. **Open late:** egen rad med stort "until 3am" som kortets huvudsiffra.
7. **Surprise me:** flytande knapp nere till höger. Slumpar ett event som börjar inom 3 h (eller pågår) i valt område och scrollar dit eller öppnar det. Ingen knapp om inget matchar.

## Kortets anatomi
- Överst: tid i accentfärg. Inom 60 min visas "in 26 min", när det pågår "On now" (pulserande prick). Annars "7:30pm".
- Titel: sans, fet, ~19–20px, max 2 rader med ellips.
- Venue · område: mindre, dämpad.
- Badge-rad (bara när datan stöder det): **Free**, **£12** (lägsta pris), **Last tickets**, **Sold out** (kortet dimmas men syns), **One night only**.
- Kategori: färgad toppkant 4px + liten etikett.
- Tid och badges får aldrig gissas fram. Saknas fält visas de inte.

## Typografi och färg
- Serifen behålls bara för sidrubriker. Kort, meta och tider är i sans.
- En accentfärg per kategori (4–5 st) med god kontrast i både ljust och mörkt läge. Tider och badges använder accenten.
- Luft: tidsrubriker och sektionsrubriker får tydliga mellanrum. Skippa tunna avdelare mellan varje rad.

## Rörelse
- Subtil: pulserande "On now"-prick, mjuk filtrering vid chip-tryck, liten skakning/zoom på Surprise me-kortet.
- Allt av under `prefers-reduced-motion`.

## Teknik
- Statisk sida: "in X min" och "On now" räknas client-side mot Europe/London och uppdateras varje minut. HTML:en från bygget visar vanlig tid som fallback.
- Event som passerat (start + 3h, eller sluttid om den finns) döljs client-side.
- Filter och Surprise me utan beroenden, inline JS.
- Inga hotlinkade bilder. Ingen bild per event behövs, färgen gör jobbet.

## Buggar att fixa samtidigt
- Open late visar "until" utan tid (t.ex. Mango). Hitta orsaken. Om sluttid saknas: visa inte "until" alls.
- "7pm" upprepas per rad i tidsgrupperade listor. I vertikala listor visas tiden som grupprubrik en gång.

## Arbetssätt
- **Steg 1:** inventera vilka fält datan faktiskt har per event och ställe: pris, biljettstatus, sluttid, koordinater, område, kategori, one-off/återkommande. Visa en tabell med fält, täckning i % ikväll och vilken feature det låser upp. Föreslå vad som utgår om täckningen är för låg. **Stanna och vänta på mitt ja.**
- **Steg 2:** bygg, Glasgow först, mallat i config.
- Batteriet ett i taget med exit-koder. Lägg till tester för badge-logiken (inget badge utan data), gångtid, filtrering och att passerade event döljs.
- Skärmdump i mobilbredd (390px), ljust och mörkt, innan push.
- Committa lokalt och **pusha inte** förrän jag skriver ja i ett nytt meddelande.
- Inga arbetsgivarnamn eller referenser någonstans.
