import { describe, it, expect } from 'vitest';
import {
  normalizeBody, parseClock, zonedToInstant, meetingWhen, formatYmd, daysBetween, relativeDays,
  substantiveItems, itemsFromAgendaText, topicsFor, buildMeetings, isUpcoming, organChips,
  buildMeetingIcs, buildMeetingJsonLd, canCalendar, type MeetingRow, type DedupeNote,
} from './meetings-view';

const TZ = 'America/Chicago';

const leg = (id: number, body: string, ymd: string, time: string | null, extra: Record<string, any> = {}): MeetingRow => ({
  id, body, meeting_date: `${ymd}T00:00:00+00:00`, agenda_url: extra.EventAgendaFile ?? null, minutes_url: null,
  raw_data: { EventId: id, EventBodyName: body, EventTime: time, EventLocation: 'Council Chambers', EventMinutesFile: null, EventVideoPath: null, ...extra },
});
const county = (id: number, body: string, ymd: string, agenda_text = ''): MeetingRow => ({
  id, body, meeting_date: `${ymd}T00:00:00+00:00`, agenda_url: `https://county.example/${id}`, minutes_url: null,
  raw_data: { place: 'no_data', agenda_text },
});

describe('normalizeBody', () => {
  it('maps the county and city spellings of one organ to one key', () => {
    expect(normalizeBody('Brookings County/City of Brookings Joint Board of Adjustment').key).toBe(normalizeBody('Joint Board of Adjustment').key);
  });
  it('never merges different organs', () => {
    expect(normalizeBody('Planning Commission').key).not.toBe(normalizeBody('Planning & Zoning Commission').key);
    expect(normalizeBody('Commission').label).toBe('County Commission');
  });
  it('keeps an unknown organ visible under its own name', () => {
    expect(normalizeBody('Weed & Pest Board')).toEqual({ key: 'weed-pest-board', label: 'Weed & Pest Board', tone: 'other' });
    expect(normalizeBody('Brookings School Board').tone).toBe('school');
  });
});

describe('time', () => {
  it('parses a clock and rejects everything else', () => {
    expect(parseClock('5:30 PM')).toEqual([17, 30]);
    expect(parseClock('12:00 AM')).toEqual([0, 0]);
    expect(parseClock('12:15 PM')).toEqual([12, 15]);
    expect(parseClock('after the joint meeting')).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
  it('turns Chicago wall time into the right instant on both sides of DST', () => {
    expect(new Date(zonedToInstant(2026, 11, 10, 17, 30, TZ)).toISOString()).toBe('2026-11-10T23:30:00.000Z'); // CST, UTC-6
    expect(new Date(zonedToInstant(2026, 7, 14, 18, 0, TZ)).toISOString()).toBe('2026-07-14T23:00:00.000Z'); // CDT, UTC-5
    expect(new Date(zonedToInstant(2026, 11, 1, 1, 30, TZ)).getTime()).toBeGreaterThan(0);
  });
  it('reads a Legistar bare date plus EventTime; no time stays no time', () => {
    const w = meetingWhen(leg(1, 'City Council', '2026-11-10', '5:30 PM'), TZ, false);
    expect(w).toMatchObject({ ymd: '2026-11-10', time: '5:30 PM' });
    expect(new Date(w.startMs!).toISOString()).toBe('2026-11-10T23:30:00.000Z');
    expect(meetingWhen(county(2, 'Commission', '2026-11-05'), TZ, false)).toEqual({ ymd: '2026-11-05', time: null, startMs: null });
  });
  it('reads a real instant in the town zone when the source has one', () => {
    const r: MeetingRow = { id: 9, body: 'x', meeting_date: '2026-11-11T01:00:00+00:00', agenda_url: null, minutes_url: null, raw_data: {} };
    expect(meetingWhen(r, 'America/Denver', true)).toMatchObject({ ymd: '2026-11-10', time: '6:00 PM' });
  });
  it('formats days without timezone maths', () => {
    expect(formatYmd('2026-11-10')).toBe('Tue, Nov 10');
    expect(formatYmd('2026-12-02', true)).toBe('Wed, Dec 2, 2026');
    expect(daysBetween('2026-11-05', '2026-11-10')).toBe(5);
    expect(relativeDays(5)).toBe('in 5 days');
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(0)).toBe('today');
  });
});

describe('substantiveItems', () => {
  const MISSION = 'The City of Brookings is committed to providing a high quality of life for its citizens and fostering a diverse economic base through innovative thinking, strategic planning, and proactive, fiscally responsible municipal management.';
  it('drops procedure, the mission statement and quorum notices, keeps the rest verbatim', () => {
    const got = substantiveItems([
      MISSION, 'Roll Call', 'Approval of Agenda', 'Approval of Minutes', 'Open Forum', 'Notice of Quorum',
      'Rezone - Lots 1A, 6B in Block 2 of Insbrook Park Addition from Industrial I-1R Restricted District to Industrial I-1 Light District.',
      'Adjournment', 'Consent Agenda', 'Second Reading and Action on Ordinance 26-024, an Ordinance Authorizing Budget Amendment No. 7 to the 2026 Budget.',
    ]);
    expect(got).toEqual([
      'Rezone - Lots 1A, 6B in Block 2 of Insbrook Park Addition from Industrial I-1R Restricted District to Industrial I-1 Light District.',
      'Second Reading and Action on Ordinance 26-024, an Ordinance Authorizing Budget Amendment No. 7 to the 2026 Budget.',
    ]);
  });
  it('drops attendance records and breaks', () => {
    expect(substantiveItems(['Record of Brookings County Commission and Brookings City Council Attendance.', 'BREAK -- reconvene the County Commission Agenda', 'Election Canvass'])).toEqual(['Election Canvass']);
  });
  it('drops anything over 200 characters instead of cutting it', () => {
    expect(substantiveItems(['x'.repeat(201), 'Utility Rate Study'])).toEqual(['Utility Rate Study']);
  });
  it('strips a leading agenda number and collapses whitespace', () => {
    expect(substantiveItems(['4.  Water   Main   Replacement'])).toEqual(['Water Main Replacement']);
  });
  it('reads the county text agenda', () => {
    const text = '1.\nCall to Order - 7:00 PM on Wednesday, Nov. 4, 2026 JJBOA.\n2.\nApproval of Joint BOA Minutes.\nDocuments:\nSept 1 Minutes.pdf\n3.\nItems to be added to agenda by commission members or staff.\n4.\nConditional Use Permit for a Wind Farm\nA.\nsub item';
    expect(itemsFromAgendaText(text)).toHaveLength(4);
    expect(substantiveItems(itemsFromAgendaText(text))).toEqual(['Conditional Use Permit for a Wind Farm']);
  });
});

describe('topicsFor (real titles from the 2026-11 inventory)', () => {
  const t = (title: string) => topicsFor([title]);
  it('labels what is clearly that topic', () => {
    expect(t('Proposed Revised 2026 Budget Third Amendment')).toEqual(['Budget']);
    expect(t('Financial Report')).toEqual(['Budget']);
    expect(t('Rezone - Lots 1A, 6B, 6C, 6D and 6E in Block 2 of Insbrook Park Addition')).toEqual(['Zoning & land use']);
    expect(t('Preliminary Plat - Lots 1A')).toEqual(['Zoning & land use']);
    expect(t('Bay Avenue Sidewalk Improvements')).toEqual(['Streets & traffic']);
    expect(t('Third Amendment to the Construction Management Agreement with WSB for the State Highway 7 Interim Widening')).toEqual(['Streets & traffic']);
    expect(t('Water Resources Master Plan')).toEqual(['Utilities']);
    expect(t('Enterprise Utility Ordinance (Ordinance No. 2308 First Reading)')).toEqual(['Utilities']);
    expect(t('Action on Temporary Alcohol / Special Event Alcoholic Beverage Licenses from existing alcohol license holders.')).toEqual(['Licenses & permits']);
    expect(t('Conditional Use Permit for a Commercial Cannabis Dispensary')).toEqual(['Zoning & land use', 'Licenses & permits']);
  });
  it('gives no label to the false hits found in the inventory', () => {
    expect(t('September 17, 2026 Library Board Meeting Minutes')).toEqual([]);
    expect(t('Concept Review for Skyestone Right-of-Way Alignment in Great Western Park')).toEqual(['Streets & traffic']); // right-of-way is a street word; the park is ignored
    expect(t('Ratification of Agreement for Emergency Repairs to Security Electronics System at Detention Center')).toEqual([]);
    expect(t('Site adjacent to 127 Causewayside Street (Ward 19) - Erection of flatted residential development')).toEqual([]);
    expect(t('Public Hearing and Action on a Special Event Temporary Alcoholic Beverage Application')).toEqual([]);
    expect(t('Municipal Code Section 9.02.020 Permitted Use Table')).toEqual([]);
    expect(t('Third Amendment to the Construction Agreement for the Depot Museum Parking Lot')).toEqual([]);
    expect(t('Ward Update - Verbal report by Police Scotland.')).toEqual([]);
  });
  it('lists each label once per meeting, in a fixed order', () => {
    expect(topicsFor(['Water Main Replacement', 'Sewer Rate Study', '2027 Budget', 'Rezone 5 acres'])).toEqual(['Budget', 'Zoning & land use', 'Utilities']);
  });
});

describe('buildMeetings: dedup', () => {
  it('keeps the Legistar row for the same date and organ and fills what it lacks from the county row', () => {
    const notes: DedupeNote[] = [];
    const rows = [
      county(15099, 'Brookings County/City of Brookings Joint Board of Adjustment', '2026-11-04', '1.\nCall to Order\n2.\nVariance for 123 Main'),
      leg(15132, 'Joint Board of Adjustment', '2026-11-04', '8:00 PM', { EventLocation: 'Brookings City & County Government Center\n520 3rd St., Room 310, Chambers' }),
    ];
    const out = buildMeetings(rows, TZ, false, notes);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 15132, source: 'legistar', time: '8:00 PM', agendaUrl: 'https://county.example/15099' });
    expect(out[0].location).toBe('Brookings City & County Government Center, 520 3rd St., Room 310, Chambers');
    expect(out[0].items).toEqual(['Variance for 123 Main']);
    expect(notes).toHaveLength(1);
  });
  it('does not merge different organs on the same day', () => {
    const out = buildMeetings([
      leg(1, 'Planning Commission', '2026-11-04', '5:30 PM'),
      county(2, 'Planning & Zoning Commission', '2026-11-04'),
    ], TZ, false);
    expect(out.map((m) => m.bodyKey).sort()).toEqual(['county-planning-zoning', 'planning-commission']);
  });
  it('merges a city and a county row only when both say joint meeting', () => {
    const jointCity = leg(15149, 'City Council', '2026-11-05', '8:30 AM', { agenda_text: 'JOINT MEETING of the Brookings County Commission and Brookings City Council' });
    const jointCounty = county(15134, 'Commission', '2026-11-05', '1.\n8:30 AM Call to Order of the Joint Meeting of the Brookings County Commission and Brookings City Council');
    const plainCounty = county(15200, 'Commission', '2026-11-05', '1.\nCall to Order of the regular meeting');
    const joint = buildMeetings([jointCity, jointCounty], TZ, false);
    expect(joint).toHaveLength(1);
    expect(joint[0]).toMatchObject({ id: 15149, jointWith: 'County Commission' });
    expect(buildMeetings([jointCity, plainCounty], TZ, false)).toHaveLength(2);
  });
  it('drops notice-of-quorum rows', () => {
    const q = leg(3, 'City Council', '2026-11-09', '12:00 PM', { agenda_text: 'Notice of Quorum ... no official city business will be acted upon' });
    expect(buildMeetings([q], TZ, false)).toEqual([]);
  });
  it('fills topics from the kept items and sorts by start', () => {
    const out = buildMeetings([
      leg(2, 'Utility Board', '2026-11-09', '1:00 PM', { agenda_items: [{ EventItemTitle: 'Roll Call' }, { EventItemTitle: 'Water Rate Study' }] }),
      leg(1, 'City Council', '2026-11-09', '8:30 AM'),
    ], TZ, false);
    expect(out.map((m) => m.id)).toEqual([1, 2]);
    expect(out[1].topics).toEqual(['Utilities']);
    expect(out[1].items).toEqual(['Water Rate Study']);
  });
});

describe('upcoming and chips', () => {
  const m = buildMeetings([leg(1, 'City Council', '2026-11-10', '5:30 PM'), county(2, 'Commission', '2026-11-10')], TZ, false);
  it('a timed meeting is upcoming until 3 h after it starts; a dated one through its day', () => {
    const start = m.find((x) => x.id === 1)!;
    expect(isUpcoming(start, start.startMs! + 2 * 3_600_000, '2026-11-10')).toBe(true);
    expect(isUpcoming(start, start.startMs! + 4 * 3_600_000, '2026-11-10')).toBe(false);
    const dated = m.find((x) => x.id === 2)!;
    expect(isUpcoming(dated, 0, '2026-11-10')).toBe(true);
    expect(isUpcoming(dated, 0, '2026-11-11')).toBe(false);
  });
  it('chips list only organs that have meetings', () => {
    expect(organChips(m).map((c) => c.label)).toEqual(['County Commission', 'City Council']); // a dated row sorts before a timed one on the same day
  });
});

describe('ics and json-ld', () => {
  const [council] = buildMeetings([leg(15138, 'City Council', '2026-11-09', '8:30 AM', { EventAgendaFile: 'https://x.example/a.pdf' })], TZ, false);
  const [bare] = buildMeetings([county(2, 'Commission', '2026-11-05')], TZ, false);
  it('writes a UTC start from the Chicago wall time', () => {
    const ics = buildMeetingIcs(council, { siteName: 'Brookings View', domain: 'brookingsview.com' }, 'https://brookingsview.com/city-hall/')!;
    expect(ics).toContain('DTSTART:20261109T143000Z');
    expect(ics).toContain('SUMMARY:City Council meeting');
    expect(ics).toContain('LOCATION:Council Chambers');
    expect(ics).toContain('UID:meeting-15138@brookingsview.com');
  });
  it('makes no .ics or JSON-LD without a start and a place, nor for county rows', () => {
    expect(canCalendar(bare)).toBe(false);
    expect(buildMeetingIcs(bare, { siteName: 's', domain: 'd' }, 'u')).toBeNull();
    expect(buildMeetingJsonLd(bare, TZ, { locality: 'Brookings', region: 'SD', country: 'US' }, 'o', 'u')).toBeNull();
  });
  it('writes Event JSON-LD with the zone offset', () => {
    const ld = buildMeetingJsonLd(council, TZ, { locality: 'Brookings', region: 'SD', country: 'US' }, 'City of Brookings', 'https://brookingsview.com/city-hall/')!;
    expect(ld['@type']).toBe('Event');
    expect(ld.startDate).toBe('2026-11-09T08:30:00-06:00');
    expect((ld.location as any).name).toBe('Council Chambers');
  });
});
