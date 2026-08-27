"""Tests for scrapers/parsers/vail_news_v1.py -- see that module's docstring
for what was verified live (2026-08-27) before this was written: no
robots.txt restriction, all three link shapes really do appear mixed in
the same listing, no lang attribute anywhere (hence the stopword heuristic
below being the ONLY translation-detection method, not a fallback).
"""
import ast
import importlib
import inspect
import pkgutil

from scrapers.parsers.vail_news_v1 import (
    VailNewsParser,
    _extract_items,
    _flag_translations,
    _parse_date,
    _resolve_url,
    _spanish_score,
)
from scrapers.base_parser import FetchResult

# Saved HTML fixture -- a trimmed but structurally real snippet of
# news.vailresorts.com/news-and-stories, covering all three link shapes
# (query-param, dated slug, vanity slug) and one confirmed EN/ES pair,
# reduced from the real markup captured live 2026-08-27.
LISTING_FIXTURE = """
<ul class="wd_layout-simple wd_item_list">
<li class="wd_item"><div class="wd_thumbnail"><a href="https://news.vailresorts.com/news-and-stories?item=123178"><img src="/file.php/179266/photo-720x480.jpg?thumbnail=144" alt="" border="0"/></a></div>
<div class="wd_item_wrapper">
	<ul class="wd_layout-inline wd_category_link_list"><li class="wd_category_link"><a href="https://news.vailresorts.com/news-and-stories?category=771">Company Announcements </a></li></ul>
	<div class="wd_title"><a href="https://news.vailresorts.com/news-and-stories?item=123178">Se Acerca un Invierno Espectacular Vail Resorts Anuncia las Fechas de Apertura mientras un Super El Nino eleva las expectativas de una gran Temporada de Nieve.</a></div>
	<div class="wd_summary"><p>Sigue de cerca la nieve con Epic Pass; el precio mas bajo del otono termina el 7 de septiembre.</p></div>
	<div class="wd_date">Aug 18, 2026</div>
</div>
</li>
<li class="wd_item"><div class="wd_thumbnail"><a href="https://news.vailresorts.com/2026-08-18-Is-Winter-About-to-Show-Off"><img src="/file.php/179266/photo2-720x480.jpg?thumbnail=144" alt="" border="0"/></a></div>
<div class="wd_item_wrapper">
	<ul class="wd_layout-inline wd_category_link_list"><li class="wd_category_link"><a href="https://news.vailresorts.com/news-and-stories?category=771">Company Announcements </a></li></ul>
	<div class="wd_title"><a href="https://news.vailresorts.com/2026-08-18-Is-Winter-About-to-Show-Off">Is Winter About to Show Off? Vail Resorts Announces 2026-27 Opening Dates as Super El Nino Builds Anticipation for Great Powder</a></div>
	<div class="wd_summary"><p>Track the snow closely with an Epic Pass; the lowest fall price ends September 7.</p></div>
	<div class="wd_date">Aug 18, 2026</div>
</div>
</li>
<li class="wd_item"><div class="wd_thumbnail"></div>
<div class="wd_item_wrapper">
	<ul class="wd_layout-inline wd_category_link_list"><li class="wd_category_link"><a href="https://news.vailresorts.com/news-and-stories?category=771">Company Announcements </a></li><li class="wd_category_link"><a href="https://news.vailresorts.com/news-and-stories?category=772">Breckenridge</a></li></ul>
	<div class="wd_title"><a href="https://news.vailresorts.com/KingdomOfBreck">Decades Later, Breckenridge Ski Resort Reclaims its Kingdom</a></div>
	<div class="wd_summary"><p>A look back at fifty years on the mountain.</p></div>
	<div class="wd_date">Aug 03, 2026</div>
</div>
</li>
<li class="wd_item"><div class="wd_thumbnail"></div>
<div class="wd_item_wrapper">
	<div class="wd_title"><a href="https://news.vailresorts.com/2026-07-30-Bill-Hornbuckle-Appointed">Bill Hornbuckle Appointed to Vail Resorts Board of Directors</a></div>
	<div class="wd_summary"><p>The company announces a new board member.</p></div>
	<div class="wd_date">Jul 30, 2026</div>
</div>
</li>
</ul>
"""

EMPTY_MARKUP = "<html><body><p>Nothing here, markup changed.</p></body></html>"


def _fetched(html: str) -> FetchResult:
    return FetchResult(raw=html.encode("utf-8"), content_type="text/html")


# ---------------------------------------------------------------------------
# _extract_items -- all three link shapes, teaser/date/category/image fields
# ---------------------------------------------------------------------------

def test_extract_items_finds_all_four():
    items = _extract_items(LISTING_FIXTURE)
    assert len(items) == 4


def test_extract_items_query_param_shape():
    items = _extract_items(LISTING_FIXTURE)
    assert items[0]["url"] == "https://news.vailresorts.com/news-and-stories?item=123178"


def test_extract_items_dated_slug_shape():
    items = _extract_items(LISTING_FIXTURE)
    assert items[1]["url"] == "https://news.vailresorts.com/2026-08-18-Is-Winter-About-to-Show-Off"


def test_extract_items_vanity_slug_shape():
    items = _extract_items(LISTING_FIXTURE)
    assert items[2]["url"] == "https://news.vailresorts.com/KingdomOfBreck"


def test_extract_items_teaser_is_verbatim_text():
    items = _extract_items(LISTING_FIXTURE)
    assert items[1]["teaser"] == "Track the snow closely with an Epic Pass; the lowest fall price ends September 7."


def test_extract_items_multiple_categories():
    items = _extract_items(LISTING_FIXTURE)
    assert items[2]["categories"] == ["Company Announcements", "Breckenridge"]


def test_extract_items_single_category():
    items = _extract_items(LISTING_FIXTURE)
    assert items[1]["categories"] == ["Company Announcements"]


def test_extract_items_image_url_resolved_absolute():
    items = _extract_items(LISTING_FIXTURE)
    assert items[0]["image_url"] == "https://news.vailresorts.com/file.php/179266/photo-720x480.jpg?thumbnail=144"


def test_extract_items_missing_image_is_none():
    items = _extract_items(LISTING_FIXTURE)
    assert items[2]["image_url"] is None


def test_extract_items_zero_items_on_changed_markup():
    assert _extract_items(EMPTY_MARKUP) == []


# ---------------------------------------------------------------------------
# _resolve_url
# ---------------------------------------------------------------------------

def test_resolve_url_already_absolute_unchanged():
    assert _resolve_url("https://news.vailresorts.com/KingdomOfBreck") == "https://news.vailresorts.com/KingdomOfBreck"


def test_resolve_url_relative_path_resolved():
    assert _resolve_url("/KingdomOfBreck") == "https://news.vailresorts.com/KingdomOfBreck"


# ---------------------------------------------------------------------------
# _parse_date
# ---------------------------------------------------------------------------

def test_parse_date_valid():
    d = _parse_date("Aug 18, 2026")
    assert (d.year, d.month, d.day) == (2026, 8, 18)


def test_parse_date_none_when_missing():
    assert _parse_date(None) is None


def test_parse_date_none_when_unparseable():
    assert _parse_date("not a date") is None


# ---------------------------------------------------------------------------
# Spanish-translation detection -- calibrated 2026-08-27 against real
# EN/ES pairs live on the site (Spanish titles scored ~0.38-0.42, English
# titles 0.0-0.05; the closest real miss, a mixed EN/ES title, scored
# 0.143 -- see module for the full calibration note).
# ---------------------------------------------------------------------------

def test_spanish_score_high_for_spanish_title():
    score = _spanish_score("Se Acerca un Invierno Espectacular Vail Resorts Anuncia las Fechas de Apertura")
    assert score > 0.15


def test_spanish_score_low_for_english_title():
    score = _spanish_score("Bill Hornbuckle Appointed to Vail Resorts Board of Directors")
    assert score < 0.05


def test_flag_translations_pairs_same_batch_by_date():
    parsed = [it for it in _extract_items(LISTING_FIXTURE)]
    from scrapers.parsers.vail_news_v1 import _parse_date as pd
    for p in parsed:
        p["published_at"] = pd(p["date_text"])
    _flag_translations(parsed, [])
    assert parsed[0]["is_translation"] is True   # Spanish item
    assert parsed[1]["is_translation"] is False  # its English pair, same date
    assert parsed[3]["is_translation"] is False  # unrelated English item


def test_flag_translations_pairs_against_prior_run_via_recent_dates():
    from datetime import date
    parsed = [{"title": "Se Acerca un Invierno Espectacular Vail Resorts Anuncia las Fechas",
               "published_at": date(2026, 8, 18)}]
    # inget par i samma batch -- finns bara i redan sparad historik
    _flag_translations(parsed, recent_english_dates=[date(2026, 8, 18)])
    assert parsed[0]["is_translation"] is True


def test_flag_translations_no_false_positive_without_english_pair():
    from datetime import date
    parsed = [{"title": "Se Acerca un Invierno Espectacular Vail Resorts Anuncia las Fechas",
               "published_at": date(2026, 8, 18)}]
    _flag_translations(parsed, recent_english_dates=[])
    # ser spanskt ut, men ingen engelsk motsvarighet hittad -- flagga ändå
    # inte som översättning (kan då bara vara en spansk originalpublicering).
    assert parsed[0]["is_translation"] is False


# ---------------------------------------------------------------------------
# parse() -- end to end against the fixture, including the fail-loud rule
# ---------------------------------------------------------------------------

def test_parse_end_to_end_row_shape():
    p = VailNewsParser({"town_id": "broomfield_co"}, {"url": "https://news.vailresorts.com/news-and-stories"})
    rows = p.parse(_fetched(LISTING_FIXTURE))
    assert len(rows) == 4
    row = rows[1]
    assert row["external_url"] == "https://news.vailresorts.com/2026-08-18-Is-Winter-About-to-Show-Off"
    assert row["title"].startswith("Is Winter About to Show Off")
    assert row["is_translation"] is False
    assert row["image_source"] == "vailresorts"
    assert row["content_hash"]


def test_parse_flags_the_spanish_duplicate_in_fixture():
    p = VailNewsParser({"town_id": "broomfield_co"}, {"url": "https://news.vailresorts.com/news-and-stories"})
    rows = p.parse(_fetched(LISTING_FIXTURE))
    assert rows[0]["is_translation"] is True


def test_parse_raises_when_markup_yields_zero_items():
    # "Fail loud, not silent" -- se moduldocstring/handoffen. En sida som
    # svarar 200 men inte innehåller ETT ENDA li.wd_item ska INTE tolkas
    # som "inget nytt att rapportera", den ska höras.
    p = VailNewsParser({"town_id": "broomfield_co"}, {"url": "https://news.vailresorts.com/news-and-stories"})
    try:
        p.parse(_fetched(EMPTY_MARKUP))
        assert False, "väntade RuntimeError, fick inget"
    except RuntimeError as exc:
        assert "0 poster" in str(exc)


# ---------------------------------------------------------------------------
# Throttle enforcement -- vail_news must go through the SAME refresh_minutes
# gate as jobs/traffic/school_alerts (runner.py:run_source), not a second,
# separate bypass (see handoff: "That throttle was silently unenforced once
# before and nearly blew a free-tier budget").
# ---------------------------------------------------------------------------

def test_registered_in_runner_registry():
    from scrapers.runner import REGISTRY
    assert REGISTRY.get("vail_news") == "scrapers.parsers.vail_news_v1:VailNewsParser"


def test_broomfield_config_sets_a_refresh_minutes_throttle():
    import json
    cfg = json.load(open("configs/broomfield_co.json", encoding="utf-8"))
    source_cfg = cfg["data_sources"]["vail_news"]
    # samma spärrmekanism som redan finns i runner.py:run_source -- inget
    # separat throttle-bygge i den här källan, se handoffens varning.
    assert source_cfg.get("refresh_minutes") == 2880  # 48h


def test_parser_does_not_implement_its_own_refresh_gate():
    # VailNewsParser ska inte ha en egen _refresh/_throttle-metod som skulle
    # kunna kringgå runner.py:s gemensamma spärr.
    src = inspect.getsource(VailNewsParser)
    assert "refresh_minutes" not in src
    assert "last_run_at" not in src


# ---------------------------------------------------------------------------
# Copyright guardrail -- no module in this feature may import the AI
# article generator. This is a feed, not a content generator (see handoff).
# ---------------------------------------------------------------------------

_FEATURE_MODULES = [
    "scrapers.parsers.vail_news_v1",
    "scripts.backfill_vail_news",
]


def _imported_names(module) -> set[str]:
    tree = ast.parse(inspect.getsource(module))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            names.update(f"{node.module}.{a.name}" for a in node.names)
    return names


def test_no_vail_news_module_imports_the_article_generator():
    for mod_name in _FEATURE_MODULES:
        module = importlib.import_module(mod_name)
        imported = _imported_names(module)
        offending = [n for n in imported if "generate_article" in n or n.endswith("content._base")
                     or n == "content._base"]
        assert not offending, f"{mod_name} imports the article generator: {offending}"


def test_no_vail_news_module_calls_generate_article():
    for mod_name in _FEATURE_MODULES:
        module = importlib.import_module(mod_name)
        src = inspect.getsource(module)
        assert "generate_article" not in src, f"{mod_name} references generate_article()"
