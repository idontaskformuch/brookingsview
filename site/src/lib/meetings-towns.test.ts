import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MEETINGS_TOWNS, buildMeetings, normalizeBody, unknownBodies, agendaNote, cleanLocation, chipCounts, followableOrgans,
  buildMeetingsFeedIcs, buildMeetingFeedItems, buildMeetingIcs, nextMeetingDescription, formatYmd, type MeetingRow, type DedupeNote,
} from './meetings-view';
import { namesPrivatePerson, ukTitleHeld, FIRST_NAMES, PLACE_WORDS } from './uk-title-guard.gb';
import { isSandboxUrl } from './sandbox-url';
import { planChips } from './ui/ui-helpers';

const BF = MEETINGS_TOWNS.broomfield_co;
const MV = MEETINGS_TOWNS.moreno_valley_ca;
const GL = MEETINGS_TOWNS.glasgow;
const SANDBOX = 'https://sandbox.agendalink.app/engage/broomfield/6a202da1e1278e0034eb47c3';

const agendaLink = (id: number, board: string, iso: string, items: string[] = []): MeetingRow => ({
  id, body: board, meeting_date: iso, agenda_url: SANDBOX, minutes_url: null,
  raw_data: {
    id: `x${id}`, board, clientId: 'broomfield', scheduleIso: iso, status: 'draft', agendaUrl: SANDBOX,
    room: { name: 'Council Chambers', address: { street: 'One DesCombes Drive' } },
    ...(items.length ? { agenda_items: items.map((title) => ({ title })) } : {}),
  },
});

describe('Broomfield (AgendaLink)', () => {
  it('one organ plus a type; the trailing space in the source string does not matter', () => {
    expect(normalizeBody('City Council Transition Meeting ', BF)).toMatchObject({ key: 'city-council', label: 'City Council', type: 'Transition' });
    expect(normalizeBody('City Council Study Session', BF).type).toBe('Study session');
    expect(normalizeBody('City Council Executive Session', BF).closed).toBe(true);
  });
  it('never links the sandbox host, and offers no agenda link of its own for it', () => {
    const [m] = buildMeetings([agendaLink(1, 'City Council Regular Meeting', '2026-11-11T01:00:00.000Z', ['Land Acknowledgement', 'Swearing In of Councilmember Peterson'])], 'America/Denver', true, undefined, BF);
    expect(isSandboxUrl(SANDBOX)).toBe(true);
    expect(m.agendaUrl).toBeNull();
    expect(m.items).toEqual(['Swearing In of Councilmember Peterson']);
    expect(JSON.stringify(m)).not.toMatch(/sandbox/);
  });
  it('reads the date in the town zone: 01:00 UTC is the previous evening in Denver', () => {
    const [m] = buildMeetings([agendaLink(1, 'City Council Regular Meeting', '2026-12-02T01:00:00.000Z')], 'America/Denver', true, undefined, BF);
    expect(m).toMatchObject({ ymd: '2026-12-01', time: '6:00 PM', dateLabel: 'Tue, Dec 1', location: 'Council Chambers, One DesCombes Drive' });
  });
  it('keeps a Regular and a Transition meeting at the same time as two meetings; the empty one says so', () => {
    const notes: DedupeNote[] = [];
    const out = buildMeetings([
      agendaLink(11824, 'City Council Regular Meeting', '2026-12-02T01:00:00.000Z', ['Swearing In of Councilmember Peterson']),
      agendaLink(11825, 'City Council Transition Meeting ', '2026-12-02T01:00:00.000Z'),
    ], 'America/Denver', true, notes, BF);
    expect(out.map((m) => m.typeLabel)).toEqual(['Regular', 'Transition']);
    expect(agendaNote(out[0])).toBeNull();
    expect(agendaNote(out[1])).toBe('No agenda published');
    expect(notes).toEqual([]);
  });
  it('a Regular and a Study session on one day are not merged (dedup key includes the type)', () => {
    const out = buildMeetings([
      agendaLink(1, 'City Council Study Session', '2026-12-02T00:00:00.000Z', ['A topic']),
      agendaLink(2, 'City Council Regular Meeting', '2026-12-02T01:00:00.000Z', ['Another topic']),
    ], 'America/Denver', true, undefined, BF);
    expect(out).toHaveLength(2);
  });
  it('a closed session promises no agenda and no link', () => {
    const [m] = buildMeetings([agendaLink(3, 'City Council Executive Session', '2026-12-02T01:00:00.000Z', ['Legal advice'])], 'America/Denver', true, undefined, BF);
    expect(m.closed).toBe(true);
    expect(m.items).toEqual([]);
    expect(agendaNote(m)).toBeNull();
  });
  it('has a public, non-sandbox agenda page on broomfield.org', () => {
    expect(BF.portal?.href).toBe('https://broomfield.org/4079/Broomfield-Council-Meetings');
    expect(isSandboxUrl(BF.portal!.href)).toBe(false);
  });
});

const escribe = (id: number, name: string, start: string, over: Record<string, any> = {}, row: Partial<MeetingRow> = {}): MeetingRow => ({
  id, body: name, meeting_date: `${start.replace(/\//g, '-').replace(' ', 'T')}.000Z`, agenda_url: '', minutes_url: null,
  raw_data: { ID: `g${id}`, MeetingName: name, StartDate: start, Location: 'City Hall Council Chamber – 14177 Frederick Street', MeetingDocumentLink: [], ...over },
  ...row,
});

describe('Moreno Valley (eSCRIBE)', () => {
  it('maps the five source strings; types for the council, none for the planning commission', () => {
    expect(normalizeBody('Closed Session City Council Meeting', MV)).toMatchObject({ key: 'city-council', type: 'Closed session', closed: true });
    expect(normalizeBody('Study Session City Council Meeting', MV).type).toBe('Study session');
    expect(normalizeBody('Planning Commission', MV).type).toBeUndefined();
  });
  it('computes the date in Pacific time: a 6 PM council meeting is the next day in UTC', () => {
    const [m] = buildMeetings([escribe(1, 'City Council Regular Meeting', '2026/11/17 18:00:00', {}, { meeting_date: '2026-11-18T02:00:00.000Z' })], 'America/Los_Angeles', true, undefined, MV);
    expect(m).toMatchObject({ ymd: '2026-11-17', time: '6:00 PM' });
  });
  it('a lost dash (U+FFFD between two spaces) is shown as the dash; nothing else shows the replacement character', () => {
    expect(cleanLocation('City Hall Council Chamber � 14177 Frederick Street')).toBe('City Hall Council Chamber – 14177 Frederick Street');
    expect(cleanLocation('Council Chamber�<br/>14177 Frederick Street')).toBe('Council Chamber, 14177 Frederick Street');
    const [m] = buildMeetings([escribe(1, 'Planning Commission', '2026/11/12 18:30:00', { Location: 'City Hall � 14177 Frederick Street' }, { meeting_date: '2026-11-13T02:30:00.000Z' })], 'America/Los_Angeles', true, undefined, MV);
    expect(m.location).not.toMatch(/�/);
  });
  it('an empty agenda_url is no link; the agenda is found in the meeting documents and resolved against the portal', () => {
    const none = buildMeetings([escribe(1, 'City Council Regular Meeting', '2026/11/17 18:00:00')], 'America/Los_Angeles', true, undefined, MV)[0];
    expect(none.agendaUrl).toBeNull();
    expect(agendaNote(none)).toBe('No agenda published');
    const docs = [
      { Type: 'Agenda', Format: '.pdf', Url: '/FileStream.ashx?DocumentId=7698' },
      { Type: 'Agenda', Format: 'HTML', Url: '/Meeting.aspx?Id=abc&Agenda=Agenda&lang=English' },
    ];
    const withAgenda = buildMeetings([escribe(2, 'City Council Regular Meeting', '2026/11/17 18:00:00', { MeetingDocumentLink: docs })], 'America/Los_Angeles', true, undefined, MV)[0];
    expect(withAgenda.agendaUrl).toBe('https://pub-morenovalley.escribemeetings.com/Meeting.aspx?Id=abc&Agenda=Agenda&lang=English');
  });
  it('the empty state names the lead time, from config', () => {
    expect(MV.emptyNote).toBe('Moreno Valley usually posts agendas 4–7 days ahead.');
  });
});

const coins = (id: number, board: string, iso: string, extra: Record<string, any> = {}): MeetingRow => ({
  id, body: board, meeting_date: iso, agenda_url: 'https://onlineservices.glasgow.gov.uk/councillorsandcommittees/committee.asp?bodyid=1', minutes_url: null,
  raw_data: { id: `coins-${id}`, board, body_id: '1', location: 'City Chambers', local_date: '10/11/2026', local_time: '11:00', schedule_iso: iso,
    agenda_url: null, committee_url: 'https://onlineservices.glasgow.gov.uk/councillorsandcommittees/committee.asp?bodyid=1', agenda_published: null, ...extra },
});

describe('Glasgow (CoInS)', () => {
  it('hides the Local Negotiating Committee for Teaching Staff', () => {
    const out = buildMeetings([
      coins(1, 'Local Negotiating Committee for Teaching Staff', '2026-11-12T10:00:00.000Z'),
      coins(2, 'Licensing Board', '2026-11-06T10:00:00.000Z'),
    ], 'Europe/London', true, undefined, GL);
    expect(out.map((m) => m.bodyLabel)).toEqual(['Licensing Board']);
  });
  it('groups every "... Area Partnership" by rule and folds the group away', () => {
    const [m] = buildMeetings([coins(1, 'Newlands/Auldburn Area Partnership', '2026-11-06T11:00:00.000Z')], 'Europe/London', true, undefined, GL);
    expect(m).toMatchObject({ chipLabel: 'Area Partnerships', collapsedGroup: 'Area Partnerships', bodyLabel: 'Newlands/Auldburn Area Partnership' });
    expect(unknownBodies([coins(1, 'Some New Area Partnership', '2026-11-06T11:00:00.000Z')], GL)).toEqual([]);
  });
  it('chips are per group, not per organ', () => {
    const ms = buildMeetings([
      coins(1, 'Licensing Board', '2026-11-06T10:00:00.000Z'), coins(2, 'Licensing and Regulatory Committee', '2026-11-13T10:00:00.000Z'),
      coins(3, 'Planning Applications Committee', '2026-11-14T10:00:00.000Z'), coins(4, 'Planning Local Review Committee', '2026-11-15T10:00:00.000Z'),
      coins(5, 'Planning Applications Committee', '2026-11-16T10:00:00.000Z'), coins(6, 'Licensing Board', '2026-11-17T10:00:00.000Z'),
    ], 'Europe/London', true, undefined, GL);
    expect(chipCounts(ms)).toEqual({ Licensing: 3, Planning: 3 });
    expect(planChips(chipCounts(ms))).toEqual(['Licensing', 'Planning']);
  });
  it('uses British dates and a 24-hour clock, and no topic labels', () => {
    const [m] = buildMeetings([coins(1, 'Licensing Board', '2026-11-06T10:00:00.000Z', { agenda_items: [{ title: 'Licensing (Scotland) Act 2005 - Applications for Various Types of Licences' }] })], 'Europe/London', true, undefined, GL);
    expect(m).toMatchObject({ dateLabel: 'Fri 6 Nov', time: '10:00', topics: [] });
    expect(formatYmd('2026-11-06', true, 'gb')).toBe('Fri 6 Nov 2026');
  });
  it('only the source\'s own agenda link is an agenda; the committee page is not', () => {
    const none = buildMeetings([coins(1, 'Licensing Board', '2026-11-06T10:00:00.000Z')], 'Europe/London', true, undefined, GL)[0];
    expect(none.agendaUrl).toBeNull();
    const out = buildMeetings([coins(2, 'Licensing Board', '2026-11-06T10:00:00.000Z', { agenda_url: 'https://onlineservices.glasgow.gov.uk/councillorsandcommittees/Agenda.asp?meetingid=1', agenda_published: '04/11/2026' })], 'Europe/London', true, undefined, GL)[0];
    expect(out.agendaUrl).toMatch(/Agenda\.asp/);
    expect(out.agendaPublished).toBe('2026-11-04');
  });
  it('holds back an agenda title that names a private person or a proceeding, and keeps the meeting', () => {
    const [m] = buildMeetings([coins(1, 'Licensing Board', '2026-11-06T10:00:00.000Z', {
      agenda_items: [
        { title: 'Licensing (Scotland) Act 2005 - Section 84, Personal Licence Review.' },
        { title: 'Application by Fiona Murray for a premises licence' },
        { title: 'Licensing (Scotland) Act 2005 - Applications for Various Types of Licences' },
      ],
    })], 'Europe/London', true, undefined, GL);
    expect(m.items).toEqual(['Licensing (Scotland) Act 2005 - Applications for Various Types of Licences']);
  });
});

describe('uk-title-guard is the Python gate', () => {
  const fixture: { text: string; held: boolean }[] = JSON.parse(readFileSync(resolve(__dirname, 'uk-title-guard.fixture.json'), 'utf8'));
  it('gives the Python verdict on every real Glasgow agenda title and every synthetic case in the fixture', () => {
    const wrong = fixture.filter((f) => ukTitleHeld(f.text) !== f.held);
    expect(wrong).toEqual([]);
    expect(fixture.some((f) => f.held)).toBe(true);
  });
  it('word lists equal the Python lists (change the rules in ai_pipeline/uk_guardrails.py first)', () => {
    const py = readFileSync(resolve(__dirname, '../../../ai_pipeline/uk_guardrails.py'), 'utf8');
    const list = (name: string) => new Set((new RegExp(`${name} = frozenset\\("""([\\s\\S]*?)"""`).exec(py)![1]).split(/\s+/).filter(Boolean));
    expect(FIRST_NAMES).toEqual(list('_FIRST_NAMES'));
    expect(PLACE_WORDS).toEqual(list('_PLACE_WORDS'));
  });
  it('lets a public office-holder and a place through', () => {
    expect(namesPrivatePerson('Motion by Councillor Laura Doherty: climate')).toBe(false);
    expect(namesPrivatePerson('Victoria Park Area Partnership')).toBe(false);
  });
});

describe('unknown organs (QA check)', () => {
  it('lists an organ that no table knows, per town, with its row count', () => {
    expect(unknownBodies([agendaLink(1, 'City Council Regular Meeting', '2026-11-11T01:00:00.000Z'), agendaLink(2, 'Parks Board', '2026-11-12T01:00:00.000Z'), agendaLink(3, 'Parks Board', '2026-11-13T01:00:00.000Z')], BF))
      .toEqual([{ body: 'Parks Board', rows: 2 }]);
  });
  it('every Brookings organ the database has is listed, including the six added 2026-11-05', () => {
    const B = MEETINGS_TOWNS.brookings_sd;
    for (const n of ['Brookings County 765kV Transmission Line Advisory Committee', 'Brookings County Housing & Redevelopment Commission', 'Brookings County Outdoor Adventure Center Advisory Board', 'Weed & Pest Board', 'Extension Board', 'Local Emergency Planning Committee']) {
      expect(B.bodies[n]).toBeTruthy();
    }
  });
});

describe('feeds', () => {
  const site = { siteName: 'Broomfield View', domain: 'broomfieldview.com' };
  const ms = buildMeetings([
    { ...agendaLink(1, 'City Council Regular Meeting', '2026-11-11T01:00:00.000Z', ['A topic']), created_at: '2026-11-01T12:00:00.000Z' },
    { ...agendaLink(2, 'City Council Study Session', '2026-11-18T01:00:00.000Z', ['B topic']), created_at: '2026-11-03T12:00:00.000Z' },
  ], 'America/Denver', true, undefined, BF);
  it('a subscribable calendar holds every meeting with a place and a time, titled with the type', () => {
    const ics = buildMeetingsFeedIcs(ms, site, 'https://broomfieldview.com/city-hall/', 'Broomfield meetings');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('X-WR-CALNAME:Broomfield meetings');
    expect(ics).toContain('SUMMARY:City Council · Study session meeting');
    expect(ics).not.toMatch(/sandbox/);
  });
  it('an organ with nothing scheduled is still a valid calendar', () => {
    const ics = buildMeetingsFeedIcs([], site, 'https://broomfieldview.com/city-hall/', 'Nothing');
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
  it('one RSS item per new meeting, newest first; no agenda item where the source gives no publish date', () => {
    const items = buildMeetingFeedItems(ms, 'https://broomfieldview.com/city-hall/');
    expect(items.map((i) => i.guid)).toEqual(['meeting-2-scheduled', 'meeting-1-scheduled']);
    // the RSS library derives each item's guid from its link: two items sharing a link would be read as one
    expect(new Set(items.map((i) => i.link)).size).toBe(items.length);
    expect(items[0].title).toBe('New meeting: City Council · Study session, Tue, Nov 17, 6:00 PM');
    expect(items[0].description).toBe('Tue, Nov 17, 6:00 PM · Council Chambers, One DesCombes Drive');
  });
  it('an agenda the source dates itself becomes an "Agenda published" item linking to the agenda', () => {
    const [m] = buildMeetings([{ ...coins(9, 'Licensing Board', '2026-11-06T10:00:00.000Z', { agenda_url: 'https://onlineservices.glasgow.gov.uk/councillorsandcommittees/Agenda.asp?meetingid=9', agenda_published: '04/11/2026', agenda_items: [{ title: 'Applications' }] }), created_at: '2026-10-20T00:00:00.000Z' }], 'Europe/London', true, undefined, GL);
    const items = buildMeetingFeedItems([m], 'https://glasgowview.com/city-hall/');
    expect(items.map((i) => i.guid)).toEqual(['meeting-9-agenda', 'meeting-9-scheduled']);
    expect(items[0].link).toMatch(/Agenda\.asp\?meetingid=9/);
  });
  it('lists every organ a town knows for following, plus organs in the data', () => {
    const organs = followableOrgans(ms, BF);
    expect(organs).toEqual([{ key: 'city-council', label: 'City Council' }]);
    expect(followableOrgans([], GL).length).toBeGreaterThanOrEqual(20);
  });
  it('a meeting description leads with the type and the town\'s date style', () => {
    expect(nextMeetingDescription(ms[0], 'Broomfield')).toMatch(/^Next: City Council · Regular, Tue, Nov 10, 6:00 PM\./);
    expect(buildMeetingIcs(ms[0], site, 'https://x.test/')).toContain('SUMMARY:City Council · Regular meeting');
  });
});
