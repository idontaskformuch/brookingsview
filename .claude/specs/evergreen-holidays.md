# Spec: årsoberoende helgsidor (alla städer)

Källa: ägarens handoff 2026-11-04. Måste vara klart och pushat FÖRE 13 nov så att /veterans-day/ (Broomfield) aldrig går noindex.

## Mål
Helgsidor som /veterans-day/ och /thanksgiving/ bygger auktoritet år efter år. Ingen sida går noindex efter fönstret. Samma URL varje år, uppdateras med nya uppgifter.

## Menyregler
- Inga nya flikar i swipe-raden. Helgsidor får aldrig egna tabs.
- En enda ingång: "Holidays" i All-sheeten, i en befintlig grupp (mest praktiska/info-gruppen per stad, i config). Leder till /holidays/.
- /holidays/ listar stadens helgsidor i kalenderordning, nästa helg överst. Rad = namn, datum, länk. Ingen brödtext.
- Startsidan och /events/: högst ETT kontextkort åt gången, bara när en helg är i sitt aktiva fönster. Två öppna fönster = närmaste helgen. Utanför fönster inget kort.
- Test: swipe-radens antal flikar per stad oförändrat. Inga helgsidor i tab-raden. Högst ett helgkort renderas.

## Sidans tillstånd (beräknas från datum vid bygge; cron bygger dagligen)
1. Aktiv (fönster, t.ex. 10 dagar före till dagen efter): årets uppgifter. Titel med år och datum, t.ex. "Veterans Day 2026 in Broomfield: what's closed on Nov 11".
2. Utanför fönster: senaste årets uppgifter, tydligt märkta: "These are the 2026 hours. 2027 hours are posted in early November." Raden "Next Veterans Day: Wednesday, Nov 11, 2027". Titel utan år eller neutralt, t.ex. "Veterans Day in Broomfield: closures and hours". Ingen AI-prosa, bara fakta, källor och "checked"-datum.
- Indexering: alltid index. Ta bort noindex-fönstret från /veterans-day/ och /thanksgiving/.
- Event-JSON-LD: bara för event som inte passerat. Efter eventdatumet bort, eventet kan ligga kvar som text märkt som förra årets.
- Sitemap: sidan alltid med. lastmod = senaste faktiska datauppdatering, inte byggdatum.

## Tunt innehåll (AdSense)
- Helgsida för en stad skapas först när den har minst en bekräftad rad från officiell källa. Inga tomma skal.
- Inga sidor för helger utan lokal effekt.

## Datamodell
- Gemensam modul för datumregler (fasta datum, "fjärde torsdagen" osv.), per land (US, UK för Glasgow).
- Bildpoolens HOLIDAYS-fönster rörs inte. Får använda samma datumfunktion, men sidfönster och bildfönster är separata fält.
- Per stad och helg: rader med status (confirmed/unconfirmed), source, checkedAt, checkAt, season (år). metaOverride behålls som valfritt fält.

## Omfattning nu
- Ramverk + /holidays/.
- Migrera /veterans-day/ (Broomfield) och /thanksgiving/ (tre US-sajter).
- Glasgow: bara ramverksstöd för UK-datum. Inga sidor förrän bekräftade källor.
- Inga nya helger i den här körningen.

## Arbetssätt
- Steg 1: inventera helgkod, nav-config, sitemap-logik. Tabell (fil, ändring, varför). STANNA, vänta på ägarens ja.
- Steg 2: bygg. Robots först om någon källa hämtas.
- Batteri ett i taget med exit-koder: vitest, astro check, pytest, bygge + disjoint, plus nya nav- och sitemap-tester.
- Commit lokalt, pusha inte före ägarens ja i nytt meddelande.
- Inga arbetsgivarnamn/referenser i kod, commits eller docs.

## Extra
- Brookings redirectar /veterans-day/ till startsidan. Kolla om det är generell fallback för okända sidor. Om ja: ersätt med riktig 404 som Moreno, på alla sajter. Om avsiktlig per-stad-avstängning: rapportera bara, ändra inget.
