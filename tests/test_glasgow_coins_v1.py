"""scrapers/parsers/glasgow_coins_v1.py against saved real CoInS pages
(fetched 2026-10-22). Pure functions, no network."""
from pathlib import Path

from scrapers.parsers.glasgow_coins_v1 import (
    GlasgowCoinsParser, items_to_text, parse_agenda, parse_meeting_list,
)

FX = Path(__file__).parent / "fixtures" / "glasgow_coins"


def _read(name: str) -> str:
    return (FX / name).read_text(encoding="latin-1")


def test_list_page_1_rows_and_agenda_link():
    rows = parse_meeting_list(_read("latest_meetings_p1.html"))
    assert len(rows) == 10
    by_body = {r["board"]: r for r in rows}
    assert "Baillieston Area Partnership" in by_body
    admin = [r for r in rows if r["board"] == "City Administration Committee"]
    assert len(admin) == 3
    first = next(r for r in admin if r["local_date"] == "22/10/2026")
    assert first["meeting_id"] == "20670"
    assert first["agenda_url"].endswith("Agenda.asp?meetingid=20670")
    assert first["agenda_published"] == "16/10/2026"
    assert first["location"] == "City Chambers, Glasgow"


def test_meeting_without_agenda_has_no_agenda_url_and_blank_published():
    rows = parse_meeting_list(_read("latest_meetings_p1.html"))
    calton = next(r for r in rows if r["board"] == "Calton Area Partnership")
    assert calton["meeting_id"] is None and calton["agenda_url"] is None
    assert calton["agenda_published"] is None
    assert calton["committee_url"].endswith("committee.asp?bodyid=1765")


def test_local_time_converts_to_utc_across_the_clock_change():
    rows = parse_meeting_list(_read("latest_meetings_p1.html"))
    # 22/10/2026 10:00 is BST (UTC+1); 05/11/2026 10:00 is GMT (UTC+0).
    bst = next(r for r in rows if r["local_date"] == "22/10/2026")
    gmt = next(r for r in rows if r["local_date"] == "05/11/2026" and r["board"].startswith("City Admin"))
    assert bst["schedule_iso"].startswith("2026-10-22T09:00:00")
    assert gmt["schedule_iso"].startswith("2026-11-05T10:00:00")


def test_licensing_board_and_licensing_committee_are_present():
    rows = parse_meeting_list(_read("latest_meetings_p3.html"))
    boards = {r["board"] for r in rows}
    assert "Licensing Board" in boards
    assert "Licensing and Regulatory Committee" in boards
    assert any("Area Partnership" in b for b in boards)


def test_identity_is_body_and_local_date_and_stable_when_agenda_appears():
    rows = parse_meeting_list(_read("latest_meetings_p1.html"))
    first = next(r for r in rows if r["local_date"] == "22/10/2026")
    assert first["id"] == "1875-20261022"


def test_row_with_bad_date_or_time_is_skipped():
    html = ('<table class="resultsNew"><tr><td><a href="committee.asp?bodyid=1">X</a></td>'
            '<td>soon</td><td>10:00</td><td></td><td>Here</td></tr>'
            '<tr><td><a href="committee.asp?bodyid=1">X</a></td>'
            '<td>31/02/2026</td><td>10:00</td><td></td><td>Here</td></tr>'
            '<tr><td><a href="committee.asp?bodyid=1">X</a></td>'
            '<td>01/03/2026</td><td>tbc</td><td></td><td>Here</td></tr></table>')
    assert parse_meeting_list(html) == []


def test_agenda_items_groups_and_papers_links():
    items = parse_agenda(_read("agenda_20670.html"))
    assert [i["item_number"] for i in items] == ["1", "2", "3", "4", "5"]
    assert items[0]["agenda_group"] == "City Convener for Education and Early Years - Councillor Elaine McSporran"
    assert items[2]["agenda_group"] == "Leader of the Council - Councillor Richard Bell"
    assert items[0]["title"].startswith("Proposals for primary school reserved places")
    assert "View Papers" not in items[0]["title"]
    assert items[0]["papers_url"].endswith("submissiondocuments.asp?submissionid=123743")


def test_items_to_text_is_one_line_per_item():
    text = items_to_text(parse_agenda(_read("agenda_20670.html")))
    lines = text.splitlines()
    assert len(lines) == 5
    assert lines[2].startswith("3. [Leader of the Council - Councillor Richard Bell] Glasgow's Local Child Poverty")


def test_parse_builds_meeting_records_with_agenda_text():
    p = GlasgowCoinsParser({"town_id": "glasgow", "timezone": "Europe/London"}, {})
    rows = parse_meeting_list(_read("latest_meetings_p1.html"))
    for r in rows:
        if r["meeting_id"] == "20670":
            r["_items"] = parse_agenda(_read("agenda_20670.html"))
    p._meetings = rows
    recs = p.parse(None)
    assert len(recs) == 10
    admin = next(r for r in recs if r["raw_data"]["meeting_id"] == "20670")
    assert admin["body"] == "City Administration Committee"
    assert admin["meeting_date"].isoformat().startswith("2026-10-22T09:00:00")
    assert admin["agenda_url"].endswith("Agenda.asp?meetingid=20670")
    assert "agenda_text" in admin["raw_data"] and len(admin["raw_data"]["agenda_items"]) == 5
    calton = next(r for r in recs if r["body"] == "Calton Area Partnership")
    assert calton["agenda_url"].endswith("committee.asp?bodyid=1765")
    assert "agenda_text" not in calton["raw_data"]
    assert len({r["content_hash"] for r in recs}) == 10


def test_exclude_bodies_drops_whole_bodies():
    p = GlasgowCoinsParser({"town_id": "glasgow"}, {"exclude_bodies": ["Calton Area Partnership"]})
    p._meetings = parse_meeting_list(_read("latest_meetings_p1.html"))
    bodies = {r["body"] for r in p.parse(None)}
    assert "Calton Area Partnership" not in bodies and "Baillieston Area Partnership" in bodies
