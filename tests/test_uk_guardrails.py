"""ai_pipeline/uk_guardrails.py -- Glasgow phase 5 gate (contempt of court,
no private individuals). Real Glasgow agenda text must pass; the cases the
owner named must be held."""
import pytest

from ai_pipeline.uk_guardrails import contempt_hits, hold_reasons, is_uk, private_person_hits

GB = {"country": "gb"}
US = {"country": "us"}

# Real agenda_text from CoInS, 2026-10-22 (must NOT be held)
REAL_OK = [
    "1. [City Convener for Education and Early Years - Councillor Elaine McSporran] Proposals for primary school "
    "reserved places for school session 2027/28 - Report by City Convener for Education and Early Years.",
    "4. [City Convener for Housing and Development - Councillor Ruari Kelly] Implementation of Planning Policy "
    "Developer Contributions - Report by Councillor Ruairi Kelly, Depute Leader and City Convener for Housing and Development.",
    "1. Civic Government (Scotland) Act 1982 - Complaints against various licence holders - Report by Director of Legal and Administration.\n"
    "2. Applications for various types of licences - Report by Director of Legal and Administration.",
    "1. Application for planning permission:-\n(a). Site at Kelvindatle Road and Wyndford Road (Ward 15) - 26/00340/FUL - "
    "Erection of residential development and community hub with associated works and public realm improvements;\n"
    "2. 1 Dundas Street (Ward 10):-\n(a). Application for Listed Building Consent - 26/01535/LBA - Display of internally illuminated signage (retrospective)",
    "Hearing - Site To The South Of Titwood Bowling Club 77 Glencairn Drive (Ward 6) - 26/00379/FUL - Formation of 3no. padel courts",
    "Victoria Park Area Partnership, Barlanark Community Centre, 33 Burnmouth Road, Glasgow, G33 4RZ",
    "Chief Executive's Department - Governance Review; Corporate Review - Freedom of Information Requests",
]


@pytest.mark.parametrize("text", REAL_OK)
def test_real_glasgow_agenda_text_passes(text):
    assert hold_reasons(GB, text) == []


@pytest.mark.parametrize("text", [
    "A man was arrested in Govan on Tuesday",
    "He has been charged with an offence and will appear at Glasgow Sheriff Court",
    "The High Court in Glasgow heard the trial of the accused",
    "Police are questioning a suspect after the incident",
    "The procurator fiscal is considering the case",
    "Sentencing is expected next month",
])
def test_contempt_of_court_is_held(text):
    assert contempt_hits(text)
    assert any(r.startswith("contempt") for r in hold_reasons(GB, text))


@pytest.mark.parametrize("text", [
    "Application for a personal licence under the Licensing (Scotland) Act 2005",
    "Review of a premises licence; licence holder Mr Brown",
    "Application by John Smith for a house in multiple occupation at 12 High Street",
    "Planning permission at 45 Byres Road. Applicant: Margaret Campbell",
    "Objection from Mrs Patel regarding the extension",
    "Appeal by Gordon Reid against refusal of consent",
    "Erection of dwellinghouse for Alasdair Murray at Hughenden Lane",
])
def test_private_individuals_are_held(text):
    assert private_person_hits(text), text
    assert any(r.startswith("private person") for r in hold_reasons(GB, text))


def test_addresses_are_fine():
    assert hold_reasons(GB, "Erection of a dwellinghouse at 12 High Street, Glasgow G1 1AA (Ward 10)") == []


def test_councillors_named_by_office_are_exempt_but_a_bare_name_is_not():
    assert private_person_hits("Report by Councillor Richard Bell, Leader of the Council") == []
    assert private_person_hits("Provost Jacqueline McLaren opened the meeting") == []
    assert private_person_hits("Report by Richard Bell") != []


def test_gate_is_off_for_us_towns():
    assert not is_uk(US)
    assert hold_reasons(US, "A man was arrested; applicant John Smith") == []
    assert is_uk(GB)
