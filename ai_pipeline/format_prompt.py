"""AI-formateringslager — gör rådata till varma, faktastrikta digests.

Hybridmodell (enligt PLAN):
  - Ren strukturerad data (väder, matchtider, priser) TEMPLATAS utan AI där det räcker.
  - AI väver ihop det som tjänar på kontext (möten, "vad byggs", veckans events).

Varje AI-genererad text passerar guardrails.validate(). Faller den → ett striktare
omförsök → annars fallback till ren mall. Vi publicerar hellre en torr men korrekt
rad än en påhittad uppgift.

Kostnad hålls nere med batchning + ett hårt månadsbudget-tak (ai.monthly_budget_usd).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

from ai_pipeline import guardrails

try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None


# --- systemprompt byggd ur configen ----------------------------------------

def build_system_prompt(cfg: dict) -> str:
    ed = cfg.get("editorial", {})
    ai = cfg.get("ai", {})
    pos = cfg.get("positioning", {})
    never = "\n".join(f"- {x}" for x in ed.get("never_publish", []))
    tone = ai.get("tone_guidelines", "Warm, friendly, plain-language, strictly factual.")
    return f"""You write short local-news blurbs for {cfg['display_name']}, {cfg['state']}.
The site answers: "{pos.get('question_we_answer', "What's happening?")}" and must feel
{pos.get('feeling', 'positive and welcoming')}.

VOICE: {tone}

HARD RULES:
- ALWAYS write the blurb in English, regardless of what language the guidance
  above happens to be written in -- the site itself is English-language.
- Use ONLY facts present in the SOURCE DATA provided. Never invent names, numbers,
  dates, quotes, or details. If a detail is not in the source, do not state it.
- No opinion, no political framing, neutral on any contested civic matter.
- Never write any of the following:
{never}
- Keep it short (2-5 sentences), concrete, and genuinely useful to a resident.
Return ONLY the blurb text, no preamble, no markdown headers."""


# --- template-fallbacks (ingen AI) -----------------------------------------

def template_weather(payload: dict, cfg: dict) -> str:
    periods = payload.get("periods", [])
    if not periods:
        return ""
    p = periods[0]
    return (f"{p.get('name','Today')} in {cfg['display_name']}: {p.get('short','')}, "
            f"around {p.get('temp')}°{p.get('unit','F')}. Wind {p.get('wind','')}.").strip()


def template_sports(rec: dict, cfg: dict) -> str:
    when = rec.get("starts_at", "")
    opp = rec.get("opponent", "their opponent")
    ha = "at home" if rec.get("home_away") == "home" else "on the road"
    base = f"The SDSU Jackrabbits ({rec.get('sport','')}) play {opp} {ha}"
    if rec.get("venue"):
        base += f" at {rec['venue']}"
    if when:
        base += f" on {when}"
    if rec.get("result"):
        base += f". Final: {rec['result']}"
    return base + "."


def template_ag(rec: dict, cfg: dict) -> str:
    return (f"{rec.get('commodity','').title()} price: "
            f"{rec.get('price')} {rec.get('unit','')} (source: USDA NASS).").strip()


TEMPLATERS = {
    "weather": template_weather,
    "sports": template_sports,
    "ag": template_ag,
}


# --- budget-spårning --------------------------------------------------------

_BUDGET_FILE = os.environ.get("AI_BUDGET_STATE", ".ai_budget.json")
# grov prisuppskattning (USD per token) — justera mot aktuell prislista
_USD_PER_INPUT_TOKEN = 3.0 / 1_000_000
_USD_PER_OUTPUT_TOKEN = 15.0 / 1_000_000


def _spent_this_month() -> float:
    try:
        with open(_BUDGET_FILE) as f:
            data = json.load(f)
        from datetime import date
        if data.get("month") == date.today().strftime("%Y-%m"):
            return float(data.get("spent", 0.0))
    except (FileNotFoundError, ValueError):
        pass
    return 0.0


def _record_spend(usd: float) -> None:
    from datetime import date
    month = date.today().strftime("%Y-%m")
    spent = _spent_this_month() + usd
    with open(_BUDGET_FILE, "w") as f:
        json.dump({"month": month, "spent": spent}, f)


# --- huvud-API --------------------------------------------------------------

@dataclass
class FormatResult:
    text: str
    generated_by: str      # "ai:<model>" | "template" | "template_fallback"
    verified: bool


def format_record(record: dict, source_type: str, cfg: dict,
                  client=None) -> FormatResult:
    """Formatera en post till publicerbar text, guardrail-validerad."""
    ai_cfg = cfg.get("ai", {})

    # 1. ren strukturerad data → mall, ingen AI
    if source_type in TEMPLATERS and source_type in ("weather", "sports", "ag"):
        text = TEMPLATERS[source_type](record.get("payload", record), cfg)
        return FormatResult(text=text, generated_by="template", verified=True)

    # 2. budgettak
    cap = float(ai_cfg.get("monthly_budget_usd", 20))
    if _spent_this_month() >= cap:
        return _fallback(record, source_type, cfg, reason="budget cap nådd")

    # 3. AI-formatering. En explicit `client` (t.ex. i tester) ska funka även om
    # `anthropic`-paketet inte gick att importera i den här processen -- annars är
    # dependency injection-parametern death on arrival så fort paketet saknas.
    if client is None:
        if anthropic is None:
            return _fallback(record, source_type, cfg, reason="anthropic-paket saknas")
        client = anthropic.Anthropic()  # läser ANTHROPIC_API_KEY

    model = ai_cfg.get("model", "claude-sonnet-5")
    source_text = guardrails.source_to_text(record)
    system = build_system_prompt(cfg)

    def _call(extra: str = "") -> tuple[str, object]:
        msg = client.messages.create(
            model=model, max_tokens=400, system=system + extra,
            messages=[{"role": "user",
                       "content": f"SOURCE DATA (source_type={source_type}):\n{source_text}"}],
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text"), msg.usage

    text, usage = _call()
    _record_spend(usage.input_tokens * _USD_PER_INPUT_TOKEN
                  + usage.output_tokens * _USD_PER_OUTPUT_TOKEN)

    result = guardrails.validate(text, source_text, cfg)
    if not result.passed:
        # ett striktare omförsök
        strict = ("\n\nYour previous attempt included details not found in the source. "
                  "Rewrite using ONLY facts explicitly present in the SOURCE DATA.")
        text, usage = _call(strict)
        _record_spend(usage.input_tokens * _USD_PER_INPUT_TOKEN
                      + usage.output_tokens * _USD_PER_OUTPUT_TOKEN)
        result = guardrails.validate(text, source_text, cfg)

    if result.passed:
        return FormatResult(text=text, generated_by=f"ai:{model}", verified=True)

    # 4. gav sig inte → ren mall-fallback
    return _fallback(record, source_type, cfg,
                     reason=f"guardrail: {'; '.join(result.violations)}")


def _fallback(record: dict, source_type: str, cfg: dict, reason: str) -> FormatResult:
    templater = TEMPLATERS.get(source_type)
    if templater:
        return FormatResult(text=templater(record.get("payload", record), cfg),
                            generated_by="template_fallback", verified=True)
    # sista utväg: en minimal, säker faktarad
    title = record.get("title") or record.get("body") or record.get("description") or ""
    return FormatResult(text=str(title).strip(),
                        generated_by="template_fallback", verified=bool(title))
