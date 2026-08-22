"""Regression tests for scrapers/text_sanity.py -- the corruption-detection
heuristic added alongside the events.py explicit-decoding fix. No heuristic
here is perfect (see module docstring); these tests pin the specific cases
that motivated adding it."""
from scrapers.text_sanity import is_suspicious


def test_normal_english_text_is_not_suspicious():
    assert not is_suspicious("Toddler Time at the Iris Plaza branch, 10am.")


def test_none_and_empty_are_not_suspicious():
    assert not is_suspicious(None)
    assert not is_suspicious("")


def test_occasional_accented_characters_are_fine():
    assert not is_suspicious("Café night at the community center, free entrée included.")


def test_replacement_character_is_suspicious():
    assert is_suspicious("Toddler Time ��� at the library")


def test_long_repeated_character_run_is_suspicious():
    assert is_suspicious("Family Fun !!!!!!!!!!!!!!!!!!!! Storytime")


def test_wholesale_non_latin_script_is_suspicious():
    # Real-world shape of the claimed bug: an entire field degraded into a
    # different script.
    assert is_suspicious("กขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ")


def test_short_run_of_repeated_punctuation_is_not_suspicious():
    # A genuinely enthusiastic human wrote "Free!!!" -- shouldn't trip the
    # long-run threshold (8+).
    assert not is_suspicious("Free admission!!! Bring the whole family.")
