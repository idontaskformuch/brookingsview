"""_write_config() merges newly-applied (town, season) entries into the
EXISTING config/this-week-images.ts file rather than replacing the whole
THIS_WEEK_IMAGES array -- see that function's own 2026-10-06 comment for
the real bug this fixes: the previous version blindly overwrote the array
with only whatever one `--apply` run processed, which happened to look
safe only because every previously-applied season's own
.review_montages/{town}-{season}-chosen.json sidecar was still on disk (so
a plain `--apply` always re-included every season ever applied). Once that
scratch directory is gitignored and absent on a fresh checkout/CI run, a
later `--apply --only ... winter` would have silently DROPPED every autumn
entry instead of leaving it alone. These tests exercise _write_config()
directly against a real temp file, not the full --apply CLI flow (which
would need live Pexels calls), since that's the exact piece of logic
responsible for the merge.
"""
from __future__ import annotations

import re

import pytest

from scripts.source_this_week_images import _write_config

MARKER_START = "export const THIS_WEEK_IMAGES: ThisWeekImage[] = ["
MARKER_END = "];"


def _make_config_file(tmp_path, body: str):
    path = tmp_path / "this-week-images.ts"
    path.write_text(
        "import type { Season } from '../lib/this-week-images';\n\n"
        f"{MARKER_START}{body}\n{MARKER_END}\n",
        encoding="utf-8",
    )
    return path


def _autumn_line(town: str, n: int) -> str:
    return (
        "  { id: '" + f"{town}-autumn-{n:02d}" + "', path: '/x.png', alt: 'a', width: 1200, height: 800, "
        "seasons: ['autumn'], town_ids: ['" + town + "'], sourcePhotoId: " + str(1000 + n) + " },"
    )


def _winter_line(town: str, n: int) -> str:
    return (
        "  { id: '" + f"{town}-winter-{n:02d}" + "', path: '/y.png', alt: 'w', width: 1200, height: 800, "
        "seasons: ['winter'], town_ids: ['" + town + "'], sourcePhotoId: " + str(2000 + n) + " },"
    )


def _entry_ids(text: str) -> list[str]:
    body = text[text.index(MARKER_START) + len(MARKER_START): text.index(MARKER_END)]
    return re.findall(r"id: '([^']+)'", body)


@pytest.fixture(autouse=True)
def _point_config_at_temp_file(tmp_path, monkeypatch):
    path = _make_config_file(
        tmp_path,
        "\n" + "\n".join(_autumn_line("brookings_sd", i) for i in range(1, 16)) + "\n",
    )
    monkeypatch.setattr("scripts.source_this_week_images.CONFIG_TS", path)
    return path


def test_apply_for_a_new_season_preserves_all_existing_entries(_point_config_at_temp_file):
    config_path = _point_config_at_temp_file
    before_ids = set(_entry_ids(config_path.read_text(encoding="utf-8")))
    assert len(before_ids) == 15

    winter_lines = [_winter_line("brookings_sd", i) for i in range(1, 14)]
    _write_config(winter_lines, touched_keys={("brookings_sd", "winter")})

    after_text = config_path.read_text(encoding="utf-8")
    after_ids = set(_entry_ids(after_text))

    assert before_ids <= after_ids, (
        f"applying winter dropped existing autumn entries: {before_ids - after_ids}"
    )
    assert len(after_ids) == 15 + 13


def test_re_applying_the_same_season_replaces_only_that_seasons_entries(_point_config_at_temp_file):
    config_path = _point_config_at_temp_file
    new_autumn_lines = [_autumn_line("brookings_sd", i) for i in range(1, 5)]  # a smaller re-review
    _write_config(new_autumn_lines, touched_keys={("brookings_sd", "autumn")})

    after_ids = set(_entry_ids(config_path.read_text(encoding="utf-8")))
    assert after_ids == {f"brookings_sd-autumn-{i:02d}" for i in range(1, 5)}, (
        "re-applying the same (town, season) should replace its own old entries, not append duplicates "
        "or leave stale ones behind"
    )


def test_applying_a_second_town_preserves_the_first_towns_entries(_point_config_at_temp_file):
    config_path = _point_config_at_temp_file
    moval_lines = [_winter_line("moreno_valley_ca", i) for i in range(1, 14)]
    _write_config(moval_lines, touched_keys={("moreno_valley_ca", "winter")})

    after_ids = set(_entry_ids(config_path.read_text(encoding="utf-8")))
    assert {f"brookings_sd-autumn-{i:02d}" for i in range(1, 16)} <= after_ids
    assert {f"moreno_valley_ca-winter-{i:02d}" for i in range(1, 14)} <= after_ids


def test_unrecognized_existing_lines_are_kept_not_silently_dropped(tmp_path, monkeypatch):
    # A hand-edited or future-schema entry that doesn't match the generator's
    # own exact town_ids/seasons text shape -- _write_config must not treat
    # "I can't parse this" as "safe to delete".
    weird_line = "  { id: 'brookings_sd-autumn-99', path: '/z.png', alt: 'z', width: 1200, height: 800, seasons: ['autumn', 'winter'], town_ids: ['brookings_sd', 'broomfield_co'], sourcePhotoId: 9 },"
    path = _make_config_file(tmp_path, "\n" + weird_line + "\n")
    monkeypatch.setattr("scripts.source_this_week_images.CONFIG_TS", path)

    _write_config([_winter_line("brookings_sd", 1)], touched_keys={("brookings_sd", "winter")})

    after_ids = set(_entry_ids(path.read_text(encoding="utf-8")))
    assert "brookings_sd-autumn-99" in after_ids, "an unrecognized existing entry must be preserved, not dropped"
    assert "brookings_sd-winter-01" in after_ids
