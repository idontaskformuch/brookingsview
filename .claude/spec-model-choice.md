# Beslut: modellval (ägaren 2026-10-23)

**Haiku för ALLA AI-texter tills sajterna drar in pengar**: sammanfattningar, veckoingresser, digester, möten, moderering.
**QA-granskningen (qa/q3) stannar på Sonnet.**

1. Samla modellval i EN central config per texttyp (en rad att ändra för att uppgradera). (Idag: format_prompt.resolve_model(source_type, cfg)
   + config/pricing.py; kontrollera att alla generatorer går genom den.)
2. Logga per texttyp: andel som klarar pre_publish_check vid FÖRSTA försöket och antal omförsök.
   Om Haiku ligger KLART sämre än nuvarande modell för en typ: RAPPORTERA, byt INTE tillbaka automatiskt.
3. Lägg i state.md: **uppgradera modeller när intäkter finns.**

## Status
- [ ] central config per texttyp
- [ ] logg: första-försök-andel + omförsök per texttyp (+ rapport)
- [ ] state.md-rad om uppgradering vid intäkter
