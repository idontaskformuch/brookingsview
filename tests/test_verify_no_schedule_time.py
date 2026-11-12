"""AgendaLink's scheduleTime has its own one-hour error; meeting date and time come from scheduleIso only
(scripts/verify_no_schedule_time.mjs, every deploy workflow). Investigation 2026-11-12: Broomfield story 3447 said 7 PM for a
6 p.m. meeting."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(ROOT / "scripts" / "verify_no_schedule_time.mjs"), str(root)],
                          capture_output=True, text=True, encoding="utf-8")


def test_the_repo_reads_no_schedule_time():
    r = run(ROOT)
    assert r.returncode == 0, r.stderr


def _tree(tmp_path: Path, rel: str, text: str) -> Path:
    f = tmp_path / rel
    f.parent.mkdir(parents=True)
    f.write_text(text, encoding="utf-8")
    return tmp_path


def test_a_python_read_fails(tmp_path):
    r = run(_tree(tmp_path, "scrapers/parsers/x.py", 'when = m.get("scheduleTime")\n'))
    assert r.returncode == 1 and "scrapers/parsers/x.py:1" in r.stderr


def test_a_typescript_read_fails(tmp_path):
    r = run(_tree(tmp_path, "site/src/lib/x.ts", "const t = raw.scheduleTime;\n"))
    assert r.returncode == 1 and "site/src/lib/x.ts:1" in r.stderr


def test_a_sql_key_fails(tmp_path):
    r = run(_tree(tmp_path, "ai_pipeline/x.py", "cur.execute(\"SELECT raw_data->>'scheduleTime' FROM meetings\")\n"))
    assert r.returncode == 1


def test_prose_naming_the_field_passes(tmp_path):
    assert run(_tree(tmp_path, "scrapers/x.py", "# scheduleTime has its own one-hour error (`scheduleTime`)\n")).returncode == 0


def test_a_marked_strip_line_passes(tmp_path):
    r = run(_tree(tmp_path, "ai_pipeline/x.py", '_HIDDEN = ("scheduleTime",)  # verify_no_schedule_time: strip\n'))
    assert r.returncode == 0, r.stderr
