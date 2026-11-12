"""AgendaLink's scheduleTime never reaches the model (investigation 2026-11-12: Broomfield story 3447 said 7 PM for a 6 p.m.
meeting; source_to_text() flattened the whole raw_data, scheduleTime included, into the prompt and into the meta source check)."""
import json
from datetime import datetime, timezone

from ai_pipeline import guardrails
from ai_pipeline.publish import _without_model_hidden_raw_fields

ROW = {
    "body": "City Council Regular Meeting",
    "meeting_date": datetime(2026, 10, 28, 0, 0, tzinfo=timezone.utc),
    "raw_data": {"id": "x1", "board": "City Council Regular Meeting", "scheduleIso": "2026-10-28T00:00:00.000Z",
                 "scheduleTime": "7:00 PM", "agenda_text": "Call to order. Rezoning of 1 Main St."},
}


def test_the_model_text_has_no_schedule_time():
    text = guardrails.source_to_text(_without_model_hidden_raw_fields(ROW))
    assert "7:00 PM" not in text
    assert "Rezoning of 1 Main St." in text and "2026-10-28T00:00:00.000Z" in text


def test_the_row_itself_is_untouched():
    _without_model_hidden_raw_fields(ROW)
    assert ROW["raw_data"]["scheduleTime"] == "7:00 PM"


def test_json_text_raw_data_and_rows_without_the_field():
    as_text = {**ROW, "raw_data": json.dumps(ROW["raw_data"])}
    assert "7:00 PM" not in guardrails.source_to_text(_without_model_hidden_raw_fields(as_text))
    plain = {"body": "Planning Commission", "raw_data": {"agenda_text": "x"}}
    assert _without_model_hidden_raw_fields(plain) is plain
    assert _without_model_hidden_raw_fields({"body": "x", "raw_data": None})["raw_data"] is None


def test_publish_strips_before_the_model_call():
    src = open("ai_pipeline/publish.py", encoding="utf-8").read()
    i = src.index("ai_record = _without_model_hidden_raw_fields(ai_record)")
    assert i < src.index("uk_guardrails.evaluate(cfg, guardrails.source_to_text(ai_record") < src.index("result = format_record(\n            ai_record")
