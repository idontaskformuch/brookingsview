# Beslut: modellval (ägaren 2026-10-23)

**Haiku för ALLA AI-texter tills sajterna drar in pengar**: sammanfattningar, veckoingresser, digester, möten, moderering.
**QA-granskningen (qa/q3) stannar på Sonnet.**

1. Samla modellval i EN central config per texttyp (en rad att ändra för att uppgradera). (Idag: format_prompt.resolve_model(source_type, cfg)
   + config/pricing.py; kontrollera att alla generatorer går genom den.)
2. Logga per texttyp: andel som klarar pre_publish_check vid FÖRSTA försöket och antal omförsök.
   Om Haiku ligger KLART sämre än nuvarande modell för en typ: RAPPORTERA, byt INTE tillbaka automatiskt.
3. Lägg i state.md: **uppgradera modeller när intäkter finns.**

## Status
- [x] central config per texttyp (ai_pipeline/format_prompt.py: TEXT_MODEL = HAIKU = EN rad; CONTENT_TYPE_MODEL_OVERRIDES för enstaka typer; stadens configs ai.model läses inte längre; content/_base.py följer; kommentarsmodereringen (site/server/comment.ts) var redan Haiku; QA-granskningen qa/q3 default = Sonnet)
- [x] logg: första-försök-andel + omförsök per texttyp: api_usage loggar redan varje försök (attempt, outcome); scripts/model_quality_report.py (read-only) räknar per generator+modell och RAPPORTERAR om en modell ligger >= 15 procentenheter under en annan (min 10 körningar) -- byter aldrig automatiskt. BASLINJE 2026-10-23 (60 d, före bytet): event(Haiku) 34 % första försöket, 152 reservtexter på 257 körningar; meeting(Haiku) 50 %, 191/413 reservtexter; weekly(Haiku) 46 %, 10/28; editorial(Sonnet) 34 %; media_recension(Sonnet) 21 %; project_thread_*(Sonnet) 33-73 %; sdsu/whats_on/vardagsmiddag 100 % (få körningar).
- [x] state.md-rad om uppgradering vid intäkter (finns sedan 2026-10-23)
