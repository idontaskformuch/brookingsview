# Order 2026-10-24 (ägaren) -- svar på "behöver ditt ja"

1. JA: pusha och deploya ALLT (US via CI, Glasgow via wrangler).
2. JA: Public Library-tider enligt bibliotekets sida (20:00 mån-tors). JA: migrate_facility_hours --apply för Glasgow.
3. Denylista: Brookings city_hall 37485219 + 37469663, Brookings events 34003747, Moreno city_hall-höghuset, university-3 (36725428).
4. MODELL: Sonnet för event och möten, Haiku för övriga texttyper. Mät om första-försök-andelen förbättras (scripts/model_quality_report.py;
   baslinje före bytet: event/Haiku 34 % första försöket, meeting/Haiku 50 %).
5. Glasgow /events: expandera ÅTERKOMMANDE SERIER till kommande förekomster (nästa 30 dagar) så att listan fylls. VISA att event syns LIVE.
6. Q3 (Sonnet) BARA på Brookings och Glasgow, berörda sidor, visa före/efter.
7. Testbatteri EN gång, uppdatera state.md, avsluta med "klar för /clear".

## Status
- [ ] 1 push + deploy   - [ ] 2 DB (library, Glasgow-timmar)   - [ ] 3 denylist   - [ ] 4 modell   - [ ] 5 Glasgow-serier + live
- [ ] 6 Q3 före/efter   - [ ] 7 batteri + state.md
