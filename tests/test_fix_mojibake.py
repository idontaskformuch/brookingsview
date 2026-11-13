"""scripts/fix_mojibake.py: repairs only the cp1252-read sequences, never a correct letter (.claude/state.md, 2026-11-13)."""
from scripts.fix_mojibake import BOM, repair

# Real line, .claude/state.md at f977220 (broken) and 6d0c144 (before), "## ÖPPNA BESLUT (ägaren)".
BROKEN = "## Ã–PPNA BESLUT (Ã¤garen)"
GOOD = "## ÖPPNA BESLUT (ägaren)"
# Real line, .claude/state.md at 723d57e, written correctly into the same broken file.
CORRECT = "- FÖRSLAG (ej gjort): taket står kvar (10x marginal, begränsar bygg-frågan)."


def test_repairs_the_broken_line():
    fixed, fixes = repair(BROKEN)
    assert fixed == GOOD
    assert sum(fixes.values()) == 2


def test_leaves_correct_letters_in_a_mixed_file_alone():
    fixed, fixes = repair(BOM + BROKEN + "\n" + CORRECT + "\n")
    assert fixed == GOOD + "\n" + CORRECT + "\n"
    assert sum(fixes.values()) == 2


def test_clean_text_is_unchanged():
    assert repair(CORRECT) == (CORRECT, {})
