# Högtidslager — ladda .claude/state.md först. En session per punkt, /clear mellan.
(Ägarens handoff 2026-11-04, sparad ordagrant i sak.)

## Innehållsregler (gäller allt)
- Ingen AI-genererad prosa. Inga inledningar, ingen bakgrund om högtiden, inga "stämningstexter".
- Sidan renderas från data. Varje faktapåstående kommer från ett fält med källa.
- Text utöver data får bara förtydliga: korta etiketter och en mening där det behövs för att informationen ska gå att förstå, t.ex. "Sophämtning som skulle skett torsdag sker fredag." Inget mer.
- Varje fält har värde + käll-URL + "senast kontrollerad"-datum. Datumet visas på sidan.
- Ej bekräftat = "Ej bekräftat för 2026" + förra årets datum som referens. Gissa aldrig.
- Kolla robots.txt för varje källdomän först. Spärrad = hoppa över och lista den.
- Inget arbetsgivarnamn någonstans.

## Meta och struktur
- Fasta URL:er utan årtal: /thanksgiving/, /christmas/, /new-years/ (Glasgow: /christmas/, /hogmanay/).
- Title och meta description byggs deterministiskt från data, inte av en LLM. Mönster: "Thanksgiving 2026 in Broomfield: closures, trash pickup, events" och en description som räknar upp det sidan faktiskt innehåller.
- Self-canonical, og:title/og:description/og:url, dateModified från senaste kontroll.
- JSON-LD Event för varje event med bekräftat datum, tid och plats. Inga Event-poster för obekräftade.
- Ingen FAQ-schema.
- H1 = sidans title utan stadsnamn-upprepning. H2 per sektion.

## Session 1: ramverk + Broomfield /thanksgiving/
1. Föreslå datamodell, sidmall och meta-mönster. Visa innan bygge. Sektioner: stängt/ändrade tider (stad, bibliotek, rec centers, återvinning), sophämtning, kollektivtrafik, event (lopp, granständningar, marknader), var man får hjälp (gratis måltider, matbanker). Tom sektion visas inte.
2. Samla Broomfield-data i en tabell: fält | värde | källa | status. Turkey Day 5K/10K: bekräfta hos arrangören, inte aggregatorer. compass.broomfield.org är spärrad i robots, rör den inte.
3. Visa tabellen. Inget skrivs förrän ägaren godkänt.

## Session 2: Glasgow /christmas/
- Kärnfrågan: vad händer på George Square 2026 kontra St Enoch Square och Glasgow Green. Motstridiga uppgifter online. Använd kommunens och arrangörens egna sidor. Om källorna säger emot varandra: visa båda med datum, välj inte.
- Datum, tider, entré, vad som finns var, stängt juldagen, kollektivtrafik.
- Lägg till St Andrew's Day (30 nov) och vad som är öppet.
- Tabell först, sedan ägarens ok.

## Session 3: Brookings + Moreno Valley /thanksgiving/ och /christmas/
- Moreno: läs stadens iCal för granständningen (moval.gov/parks-comm-svc/ics/). Lägg till fler .ics-filer från samma katalog om de finns.
- Brookings: Festival of Lights och Festival of Trees. 2026-datum ej bekräftat än.
- Samma sektioner och regler som Broomfield. Tabell först.

## Senare
- Veterans Day-stängningar (11 nov) som rad på /today/ eller /closures/, inte egen sida.
- Interna länkar från startsidan och /events/ till högtidssidan medan den är aktuell.

## Noterat i state.md
- Före nästa val: koppla in Broomfields county-källa (/CO/Broomfield/) så att lokala ballot measures kommer med.
- 2462990 (state-commit) ligger lokalt och följer med nästa push.
