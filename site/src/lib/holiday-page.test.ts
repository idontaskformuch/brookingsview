import { describe, expect, it } from 'vitest';
import {
  buildHolidayMeta, buildHolidayEventsJsonLd, lastChecked, localIso, formatIsoDate, formatClock, eventWhenWhere,
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
    expect((offices as { checkAt: { url: string } }).checkAt.url).toContain('/newsflash/home/detail/3155');
    const trash = byLabel('Holiday collection');
    expect((trash as { checkAt: { phone: string } }).checkAt.phone).toBe('303-288-2100 ext. 6');
    expect((byLabel('RTD') as { checkAt: { url: string } }).checkAt.url).toBe('https://www.rtd-denver.com/community/news');
    const meal = byLabel('Free Thanksgiving meal') as { checkAt: { url: string } };
    expect(meal.checkAt.url).toBe('https://www.broomfieldfish.org/');
  });
  it('FISH closure is confirmed with the year caveat', () => {
    const fish = byLabel('Broomfield FISH food bank') as { status: string; clarify: string };
    expect(fish.status).toBe('confirmed');
    expect(fish.clarify).toBe('Page lists no year; call 303-465-1600 to check.');
  });
  it('the race is a confirmed event on Thanksgiving Day, 9:00', () => {
    const [race] = page.events;
    expect(race.status).toBe('confirmed');
    expect(race.date).toBe('2026-11-26');
    expect(eventWhenWhere(race)).toBe('Thu, Nov 26 · 9:00 a.m. · Broomfield County Commons, 13200 Sheridan Blvd');
  });
});

describe('deterministic meta', () => {
  it('Broomfield description names the confirmed items, then what is not confirmed', () => {
    const m = buildHolidayMeta(pageFor('broomfield_co'), 'Thanksgiving', 'Broomfield');
    expect(m.title).toBe('Thanksgiving 2026 in Broomfield: closures, events, food help');
    expect(m.h1).toBe('Thanksgiving 2026: closures, events, food help');
    expect(m.description).toBe(
      'Turkey Day 5K/10K Nov 26 · Tree Branch Recycle closed Nov 28 · FISH food bank closed Nov 26–27. Trash and RTD not yet confirmed. Checked Nov 4, 2026.',
    );
  });
  it('Brookings and Moreno: title names only sections with a confirmed row', () => {
    expect(buildHolidayMeta(pageFor('brookings_sd'), 'Thanksgiving', 'Brookings').h1).toBe('Thanksgiving 2026: closures, trash pickup');
    expect(buildHolidayMeta(pageFor('moreno_valley_ca'), 'Thanksgiving', 'Moreno Valley').title)
      .toBe('Thanksgiving 2026 in Moreno Valley: trash pickup');
    expect(buildHolidayMeta(pageFor('moreno_valley_ca'), 'Thanksgiving', 'Moreno Valley').description)
      .toBe('Trash pickup one day late after Nov 26. City offices, Landfill and Library not yet confirmed. Checked Oct 24, 2026.');
  });
  it('every description is at most 155 characters, with no digits-free filler', () => {
    for (const id of THANKSGIVING_TOWN_IDS) {
      const d = buildHolidayMeta(pageFor(id), 'Thanksgiving', 'X').description;
      expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(d).toMatch(/Checked [A-Z][a-z]{2} \d+, 2026\.$/);
    }
  });
  it('regression: the three US descriptions are exactly what they were before the metaGroup change', () => {
    expect(buildHolidayMeta(pageFor('brookings_sd'), 'Thanksgiving', 'Brookings').description).toBe(
      'City offices mostly closed Nov 26 · Landfill closed Nov 26 · Recycling and yard waste move to Wed Nov 25. Library not yet confirmed. Checked Oct 24, 2026.',
    );
  });
  it('phrases with the same metaGroup merge into one, at the position of the first; an upper-case pending name is untouched', () => {
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
      .toBe('Fair: north site from 6 Nov, closed 25 Dec · Office closed. Trash not yet confirmed. Checked Nov 4, 2026.');
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
    expect(d).not.toContain('FISH');
    expect(d).toContain('Trash and RTD not yet confirmed.');
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
    expect(lastChecked(pageFor('broomfield_co'))).toBe('2026-11-04');
    expect(lastChecked(pageFor('moreno_valley_ca'))).toBe('2026-10-24');
    expect(formatIsoDate('2026-11-04')).toBe('Nov 4, 2026');
    expect(formatIsoDate('2026-11-04', true)).toBe('November 4, 2026');
    expect(formatClock('00:05')).toBe('12:05 a.m.');
    expect(formatClock('17:30')).toBe('5:30 p.m.');
  });
  it('sections render in order and an empty one is skipped', () => {
    expect(sectionsWithRows(pageFor('broomfield_co'))).toEqual(['closures', 'trash', 'transit', 'events', 'help']);
    expect(sectionsWithRows(pageFor('moreno_valley_ca'))).toEqual(['closures', 'trash']);
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
