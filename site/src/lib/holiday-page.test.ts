import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildHolidayMeta, buildHolidayEventsJsonLd, checkedSpan, formatCheckedSpan, lastChecked, localIso, formatIsoDate, formatClock, eventWhenWhere,
  sectionsWithRows, regularHours, DESCRIPTION_MAX, isBlockedHost, BLOCKED_SOURCE_HOSTS, type HolidayFact, type HolidayPageData,
} from './holiday-page';
import { buildThanksgivingPage, THANKSGIVING_TOWN_IDS } from '../config/holiday-pages/thanksgiving';
import { CHRISTMAS_EVENTS } from '../config/holiday-pages/christmas';

const MOVES = { south: ['Thursday pickup moves to Friday'], north: [] };
const pageFor = (townId: string) => buildThanksgivingPage(townId, MOVES)!;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe('model types', () => {
  it('rejects facts that lack a source, a check date, or a way to find the answer', () => {
    const src = { name: 'x', url: 'https://example.org' };
    // @ts-expect-error confirmed needs value + source
    const noSource: HolidayFact = { section: 'closures', status: 'confirmed', label: 'a', value: 'v', checkedOn: '2026-11-04' };
    // @ts-expect-error unconfirmed needs lastYear or checkAt
    const noPointer: HolidayFact = { section: 'closures', status: 'unconfirmed', label: 'a', source: src, checkedOn: '2026-11-04' };
    // @ts-expect-error checkAt needs a url or a phone
    const emptyCheck: HolidayFact = { section: 'closures', status: 'unconfirmed', label: 'a', source: src, checkedOn: '2026-11-04', checkAt: { label: 'x' } };
    const ok: HolidayFact = { section: 'closures', status: 'unconfirmed', label: 'a', source: src, checkedOn: '2026-11-04', lastYear: { value: 'v', source: src } };
    expect([noSource, noPointer, emptyCheck, ok]).toHaveLength(4);
  });
});

describe('every town page', () => {
  for (const id of THANKSGIVING_TOWN_IDS) {
    const page = pageFor(id);
    it(`${id}: rows have an ISO check date, a http source, and no blocked host as a source or pointer`, () => {
      for (const f of page.facts) {
        expect(f.checkedOn).toMatch(ISO);
        expect(f.source.url).toMatch(/^https:\/\//);
        expect(isBlockedHost(f.source.url)).toBe(false);
        if (f.status === 'confirmed') expect(f.value.trim().length).toBeGreaterThan(0);
        if (f.status === 'unconfirmed') {
          expect(f.lastYear || f.checkAt).toBeTruthy();
          if (f.checkAt?.url) expect(isBlockedHost(f.checkAt.url)).toBe(false);
          if (f.lastYear) expect(isBlockedHost(f.lastYear.source.url)).toBe(false);
        }
      }
      for (const e of page.events) {
        expect(e.checkedOn).toMatch(ISO);
        expect(isBlockedHost(e.source.url)).toBe(false);
      }
    });
    it(`${id}: every row is for this page's holiday week and has no employer name`, () => {
      const text = JSON.stringify(page).toLowerCase();
      expect(text).not.toMatch(/employer|vail resorts/);
      expect(page.year).toBe(2026);
    });
  }
  it('blocked hosts appear only as link-only pointers', () => {
    const bf = pageFor('broomfield_co');
    expect(bf.linkOnly.map((l) => new URL(l.url).hostname)).toEqual(['compass.broomfield.org']);
    expect(BLOCKED_SOURCE_HOSTS).toContain('compass.broomfield.org');
    for (const id of THANKSGIVING_TOWN_IDS) {
      const text = JSON.stringify({ facts: pageFor(id).facts, events: pageFor(id).events });
      expect(text).not.toContain('compass.broomfield.org');
    }
  });
  it('returns null for a town without the page', () => {
    expect(buildThanksgivingPage('glasgow')).toBeNull();
  });
});

describe('Broomfield data as approved 2026-11-04', () => {
  const page = pageFor('broomfield_co');
  const byLabel = (l: string) => page.facts.find((f) => f.label.startsWith(l))!;
  it('unconfirmed rows point where the owner ordered', () => {
    const offices = byLabel('City offices');
    expect(offices.status).toBe('unconfirmed');
    expect((offices as { checkAt: { url: string } }).checkAt.url).toBe('https://www.broomfield.org/CivicAlerts.aspx?CID=-1'); // News Flash: no Thanksgiving notice yet on 2026-11-11
    expect((offices as { clarify?: string }).clarify).toBeUndefined(); // a link only, no text (owner 2026-11-15)
    // Owner 2026-11-15: the trash row is gone, and the RTD row with it (its link was RTD's general news page).
    expect(page.facts.find((f) => f.label.startsWith('Holiday collection'))).toBeUndefined();
    expect(page.facts.find((f) => f.label.startsWith('RTD'))).toBeUndefined();
    // Owner 2026-11-11: no row without a dated meal or distribution from FISH or the Salvation Army itself.
    expect(page.facts.find((f) => f.label === 'Free Thanksgiving meal')).toBeUndefined();
    expect((offices as { holdsCount?: boolean }).holdsCount).toBe(true);
  });
  it('FISH closure is confirmed (weekdays match 2026, read 2026-11-11) and closed on the holiday and the day after', () => {
    const fish = byLabel('Broomfield FISH food bank') as { status: string; clarify: string; closedOn: string[] };
    expect(fish.status).toBe('confirmed');
    expect(fish.clarify).not.toMatch(/no year/i);
    expect(fish.closedOn).toEqual(['2026-11-26', '2026-11-27']);
  });
  it('the race is a confirmed event on Thanksgiving Day, 9:00', () => {
    const [race] = page.events;
    expect(race.status).toBe('confirmed');
    expect(race.date).toBe('2026-11-26');
    expect(eventWhenWhere(race)).toBe('Thu, Nov 26 · 9:00 a.m. · Broomfield County Commons, 13200 Sheridan Blvd');
  });
});

describe('deterministic meta', () => {
  it('Broomfield description names only the confirmed items, then the check date (F9: nothing announced as not confirmed)', () => {
    const m = buildHolidayMeta(pageFor('broomfield_co'), 'Thanksgiving', 'Broomfield');
    expect(m.title).toBe('Thanksgiving 2026 in Broomfield: closures, events, food help');
    expect(m.h1).toBe('Thanksgiving 2026: closures, events, food help');
    expect(m.description).toBe(
      'Turkey Day 5K/10K Nov 26 · Tree Branch Recycle closed Nov 28 · FISH food bank closed Nov 26–27. Checked Nov 4 – Nov 14, 2026.',
    );
  });
  it('Brookings and Moreno: title names only sections with a confirmed row', () => {
    expect(buildHolidayMeta(pageFor('brookings_sd'), 'Thanksgiving', 'Brookings').h1).toBe('Thanksgiving 2026: closures, trash pickup');
    expect(buildHolidayMeta(pageFor('moreno_valley_ca'), 'Thanksgiving', 'Moreno Valley').title)
      .toBe('Thanksgiving 2026 in Moreno Valley: closures, trash pickup, transit'); // RTA row read 2026-11-14, library calendar rows
    expect(buildHolidayMeta(pageFor('moreno_valley_ca'), 'Thanksgiving', 'Moreno Valley').description)
      .toBe('Library closed Nov 26–27 · Trash pickup one day late after Nov 26 · No RTA buses Nov 26. Checked Oct 3 – Nov 14, 2026.');
  });
  it('every description is at most 155 characters, with no digits-free filler', () => {
    for (const id of THANKSGIVING_TOWN_IDS) {
      const d = buildHolidayMeta(pageFor(id), 'Thanksgiving', 'X').description;
      expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(d).toMatch(/Checked (?:[A-Z][a-z]{2} \d+(?:, \d{4})? – )?[A-Z][a-z]{2} \d+, 2026\.$/);
    }
  });
  it('regression: the three US descriptions are exactly what they were before the metaGroup change', () => {
    // City offices and the recycling move reworded 2026-11-15 (owner: no "mostly", no yard waste after its season ends Nov 24).
    expect(buildHolidayMeta(pageFor('brookings_sd'), 'Thanksgiving', 'Brookings').description).toBe(
      'City offices closed Nov 26 · Landfill closed Nov 26 · Thursday recycling moves to Wed Nov 25. Checked Oct 23 – Nov 14, 2026.',
    );
  });
  it('phrases with the same metaGroup merge into one, at the position of the first; the pending row is not named', () => {
    const base = pageFor('broomfield_co');
    const src = { name: 'x', url: 'https://example.org' };
    const page: HolidayPageData = {
      ...base,
      events: [{ status: 'confirmed', name: 'A', date: '2026-11-26', startTime: '09:00', venue: { name: 'v', locality: 'l' }, url: src.url,
        source: src, checkedOn: '2026-11-04', metaGroup: 'Fair', meta: 'north site from 6 Nov' }],
      facts: [
        { section: 'closures', status: 'confirmed', label: 'a', value: 'v', source: src, checkedOn: '2026-11-04', metaGroup: 'Fair', meta: 'closed 25 Dec' },
        { section: 'closures', status: 'confirmed', label: 'b', value: 'v', source: src, checkedOn: '2026-11-04', meta: 'Office closed' },
        { section: 'trash', status: 'unconfirmed', label: 'c', source: src, checkedOn: '2026-11-04', checkAt: { label: 'x', url: src.url }, meta: 'Trash' },
      ],
    };
    expect(buildHolidayMeta(page, 'Thanksgiving', 'X').description)
      .toBe('Fair: north site from 6 Nov, closed 25 Dec · Office closed. Checked Nov 4, 2026.');
  });
  it('drops whole phrases from the end of the confirmed list to fit, events first in priority', () => {
    const base = pageFor('broomfield_co');
    const long: HolidayPageData = {
      ...base,
      facts: base.facts.map((f) => (f.status === 'confirmed' && f.meta ? { ...f, meta: `${f.meta} with a much longer wording than before` } : f)),
    };
    const d = buildHolidayMeta(long, 'Thanksgiving', 'Broomfield').description;
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.startsWith('Turkey Day 5K/10K Nov 26')).toBe(true);
    expect(d).not.toMatch(/confirmed/i);
  });
  it('standing hours are not closures: the closures table holds only closure facts', () => {
    for (const id of THANKSGIVING_TOWN_IDS) {
      const page = pageFor(id);
      for (const f of page.facts.filter((x) => x.section === 'closures')) expect(f.label).not.toMatch(/regular hours/i);
      expect(regularHours(page).every((f) => /regular hours/i.test(f.label))).toBe(true);
    }
    const confirmedClosures = pageFor('broomfield_co').facts.filter((f) => f.section === 'closures' && f.status === 'confirmed');
    expect(confirmedClosures.map((f) => f.label)).toEqual(['Tree Branch Recycle and RV Wastewater Disposal Facility']);
    expect(regularHours(pageFor('broomfield_co')).map((f) => f.label)).toEqual([
      'Library (regular hours)', 'Recreation centers (regular hours)', 'Broomfield FISH marketplace (regular hours)',
    ]);
  });
  it('lastChecked is the newest checkedOn; dates format without a time zone', () => {
    expect(lastChecked(pageFor('broomfield_co'))).toBe('2026-11-14');
    expect(lastChecked(pageFor('moreno_valley_ca'))).toBe('2026-11-14');
    expect(formatIsoDate('2026-11-04')).toBe('Nov 4, 2026');
    expect(formatIsoDate('2026-11-04', true)).toBe('November 4, 2026');
    expect(formatClock('00:05')).toBe('12:05 a.m.');
    expect(formatClock('17:30')).toBe('5:30 p.m.');
  });
  it('the check date is the span from the oldest to the newest row, one date when they are equal (owner 2026-11-14)', () => {
    // Broomfield: Tree Branch and the race were read Nov 4, FISH Nov 14 -- the page must not read as all checked Nov 14.
    expect(checkedSpan(pageFor('broomfield_co'))).toEqual({ first: '2026-11-04', last: '2026-11-14' });
    expect(formatCheckedSpan({ first: '2026-11-04', last: '2026-11-14' })).toBe('Nov 4 – Nov 14, 2026');
    expect(formatCheckedSpan({ first: '2026-11-04', last: '2026-11-14' }, true)).toBe('November 4 – November 14, 2026');
    expect(formatCheckedSpan({ first: '2025-12-30', last: '2026-01-02' })).toBe('Dec 30, 2025 – Jan 2, 2026');
    expect(formatCheckedSpan({ first: '2026-11-04', last: '2026-11-14' }, false, 'en-GB')).toBe('4 Nov – 14 Nov 2026');
    expect(formatCheckedSpan({ first: '2026-11-14', last: '2026-11-14' })).toBe('Nov 14, 2026');
    const one = { ...pageFor('broomfield_co'), facts: pageFor('broomfield_co').facts.map((f) => ({ ...f, checkedOn: '2026-11-14' })), events: [] };
    expect(buildHolidayMeta(one, 'Thanksgiving', 'Broomfield').description).toMatch(/ Checked Nov 14, 2026\.$/);
    const src = readFileSync(new URL('../components/HolidayPage.astro', import.meta.url), 'utf8');
    expect(src).toContain('checkedSpan(page)');
  });
  it('sections render in order and an empty one is skipped', () => {
    // Broomfield's trash and RTD rows removed 2026-11-15 (owner), so those sections are skipped.
    expect(sectionsWithRows(pageFor('broomfield_co'))).toEqual(['closures', 'events', 'help']);
    expect(sectionsWithRows(pageFor('moreno_valley_ca'))).toEqual(['closures', 'trash', 'transit']);
  });
});

describe('Event JSON-LD', () => {
  it('is emitted for the confirmed race with the zone offset on that date', () => {
    const [ld] = buildHolidayEventsJsonLd(pageFor('broomfield_co'), 'America/Denver');
    expect(ld.startDate).toBe('2026-11-26T09:00:00-07:00');
    expect(ld.name).toBe('Broomfield Turkey Day 5K/10K');
    expect((ld.location as { address: { postalCode: string } }).address.postalCode).toBe('80020');
  });
  it('is never emitted for an unconfirmed event, and none exists where there are no events', () => {
    const page: HolidayPageData = {
      ...pageFor('broomfield_co'),
      events: [{ status: 'unconfirmed', name: 'x', date: '2026-11-27', source: { name: 's', url: 'https://example.org' }, checkedOn: '2026-11-04', checkAt: { label: 'l', url: 'https://example.org' } }],
    };
    expect(buildHolidayEventsJsonLd(page, 'America/Denver')).toEqual([]);
    expect(buildHolidayEventsJsonLd(pageFor('brookings_sd'), 'America/Chicago')).toEqual([]);
  });
  it('localIso uses winter and summer offsets', () => {
    expect(localIso('2026-12-04', '17:30', 'America/Denver')).toBe('2026-12-04T17:30:00-07:00');
    expect(localIso('2026-07-04', '09:00', 'America/Denver')).toBe('2026-07-04T09:00:00-06:00');
  });
});

describe('Christmas data saved ahead of the page', () => {
  it('keeps the Broomfield tree lighting as a confirmed event', () => {
    const [e] = CHRISTMAS_EVENTS.broomfield_co;
    expect(e.status).toBe('confirmed');
    expect(e.date).toBe('2026-12-04');
    const page: HolidayPageData = { ...pageFor('broomfield_co'), holiday: 'christmas', events: CHRISTMAS_EVENTS.broomfield_co };
    const [ld] = buildHolidayEventsJsonLd(page, 'America/Denver');
    expect(ld.startDate).toBe('2026-12-04T17:30:00-07:00');
    expect(ld.endDate).toBe('2026-12-04T20:00:00-07:00');
  });
});
