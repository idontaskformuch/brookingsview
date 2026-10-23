from scripts.model_quality_report import flag_worse, pct

H, S = "claude-haiku-4-5-20251001", "claude-sonnet-5"


def test_pct():
    assert pct(1, 4) == 25.0 and pct(0, 0) == 0.0


def test_flags_a_clearly_worse_model_but_only_reports():
    rows = [("weekly", S, 40, 38, 3, 0, 1.0), ("weekly", H, 40, 24, 20, 4, 0.2)]
    out = flag_worse(rows)
    assert len(out) == 1 and "weekly" in out[0] and H in out[0] and "do not switch automatically" in out[0]


def test_no_flag_when_close_or_when_there_is_too_little_data():
    assert flag_worse([("a", S, 40, 36, 0, 0, 1.0), ("a", H, 40, 34, 0, 0, 0.2)]) == []
    assert flag_worse([("b", S, 40, 40, 0, 0, 1.0), ("b", H, 5, 1, 9, 2, 0.1)]) == []
