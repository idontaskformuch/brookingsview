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


# --- narrower rule for events from a listed culture source (owner 2026-10-24) -------------------------------------
from ai_pipeline.uk_guardrails import evaluate, event_context  # noqa: E402
from ai_pipeline import guardrails  # noqa: E402

GB_EV = {"country": "gb", "uk_gate": {"relaxed_event_sources": ["glasgow_life"]}}
EV = dict(source_type="event", source="glasgow_life")


def test_a_fictional_character_in_the_organisers_own_description_passes():
    desc = "An exhibition on Agatha Christie and the world of Miss Marple at the Mitchell Library."
    reasons, notes = evaluate(GB_EV, desc, organiser_text="Agatha Christie: A World of Mystery " + desc, **EV)
    assert reasons == [] and any("Miss Marple" in n for n in notes)


def test_the_playwriting_workshop_passes_but_is_noted():
    title = "Getting Away with Murder: Playwriting workshops with John Binnie"
    reasons, notes = evaluate(GB_EV, title, organiser_text=title, **EV)
    assert reasons == []
    assert any("murder" in n for n in notes) and any("John Binnie" in n for n in notes)


@pytest.mark.parametrize("text", [
    "Man arrested for murder after the play",
    "A man was charged after the performance",
    "The trial of the accused is described in this talk",
    "Sentenced to life: a play about the assault",
])
def test_proceedings_still_hold_an_event(text):
    reasons, _ = evaluate(GB_EV, text, organiser_text=text, **EV)
    assert any(r.startswith("contempt") for r in reasons)


def test_a_name_the_organiser_did_not_write_is_still_held():
    reasons, _ = evaluate(GB_EV, "Host: Alison Murray", organiser_text="Halloween party at Partick Library", **EV)
    assert any("Alison Murray" in r for r in reasons)


def test_role_plus_name_is_never_relaxed():
    text = "planning applicant: Margaret Campbell"
    reasons, _ = evaluate(GB_EV, text, organiser_text=text, **EV)
    assert any(r.startswith("private person: role+name") for r in reasons)


def test_meetings_and_unlisted_sources_keep_the_full_gate():
    text = "Getting Away with Murder with John Binnie"
    assert hold_reasons(GB_EV, text)                                                     # no event context at all
    assert hold_reasons(GB_EV, text, source_type="meeting", source="glasgow_life", organiser_text=text)
    assert hold_reasons(GB_EV, text, source_type="event", source="ticketmaster", organiser_text=text)
    assert hold_reasons(GB, text, organiser_text=text, **EV)                              # config lists no relaxed source


def test_adjacent_words_only_so_a_colon_does_not_invent_a_name():
    assert not any("Campbell A" in h for h in private_person_hits("Duncan Campbell: A New No"))
    assert any("Duncan Campbell" in h for h in private_person_hits("Duncan Campbell: A New No"))


def test_event_context_is_empty_for_other_types_and_reads_the_description():
    assert event_context({"source": "glasgow_life", "title": "x"}, "meeting") == {}
    ctx = event_context({"source": "glasgow_life", "title": "Title", "raw_data": {"description": "Desc"}}, "event")
    assert ctx == {"source_type": "event", "source": "glasgow_life", "organiser_text": "Title Desc"}


def test_validate_accepts_the_organisers_name_in_generated_event_text_only_with_context():
    text = "The exhibition looks at Miss Marple."
    ctx = {"source_type": "event", "source": "glasgow_life", "organiser_text": "Exhibition on Miss Marple"}
    assert not any("UK-spärr" in v for v in guardrails.validate(text, "Exhibition on Miss Marple", GB_EV, uk_context=ctx).violations)
    assert any("UK-spärr" in v for v in guardrails.validate(text, "Exhibition on Miss Marple", GB_EV).violations)


def test_a_name_never_forms_across_a_field_boundary():
    # source fields are joined with newlines for the gate: "...with Alison Murray" + "Sat, Oct 31" is not the name "Murray Sat"
    src = guardrails.source_to_text({"title": "Halloween Party with Alison Murray", "when": "Sat, Oct 31"}, sep="\n")
    reasons, _ = evaluate(GB_EV, src, organiser_text="Halloween Party with Alison Murray", **EV)
    assert reasons == []
    assert hold_reasons(GB, "Halloween Party with Alison Murray Sat, Oct 31")                 # joined by spaces the old way: held
