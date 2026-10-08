# CLAUDE.md

## Token & Handoff Rules

1. State: vid start/slut av varje deluppgift, uppdatera .claude/state.md
   (max 30 rader): aktuell fas + deluppgift, ändrade filer, BESLUT OCH SKÄL,
   kända buggar, nästa steg, pekare till relevant handoff-fil.
   Committa efter varje deluppgift.
2. Sessionsstart: läs .claude/state.md, och bara den aktuella fasen i
   master-specen (inte hela filen). Kör git status; stoppa om trädet är smutsigt
   av något som inte står i state.md.
3. Tester: under arbetet kör bara berörd testfil. Före fas-commit kör
   en gång: hela vitest + pytest, astro check, build för alla tre städer,
   sitemap/noindex-disjoint-kontrollen.
4. Sökning: riktade sökningar (rg med filändelse/mapp). Visa diff eller
   ändrad funktion, aldrig hela filer.
5. Avslut av delmål (tester gröna): "Uppgift klar. Status sparad i
   .claude/state.md. Kör /clear och ladda state.md för nästa steg."
6. Max en session åt gången mot repot. Pusha aldrig utan godkännande.
7. Skrivningar mot den LIVE databasen (UPDATE/INSERT/DELETE/migrationer körda
   direkt mot DATABASE_URL, inte via en committad migration som bara skapar
   en kolumn) kräver ägarens godkännande innan de körs, exakt som push --
   fråga först, kör sedan. Gäller även ett skript som bara KÖR en redan
   godkänd idé på nya rader (t.ex. en omkörning av en tidigare godkänd
   dedup/regenerering) om det inte redan är explicit beordrat i samma
   instruktion.
