import { describe, expect, it } from 'vitest';
import { placesFromOverpass, openLateRows, type OsmPlace } from './osm-open-late';
import { parseOpeningHoursLoose } from './osm-hours';
import {
  timesTrusted, openUntilLabel, openTonightRows, openTonightSection, cafeRows, isHolidayDay, openLatePlaces, openLatePageIndexable, lateNights,
} from './open-tonight';

const TZ = 'America/Denver';
const DAYMS = 86_400_000;
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAYMS);
const FRIDAY = dayOf(2026, 11, 6);
const TUESDAY = dayOf(2026, 11, 10);
const CHRISTMAS = dayOf(2026, 12, 25);
// Friday 6 Nov 2026, 19:00 local (MST, UTC-7)
const NOW = new Date('2026-11-07T02:00:00Z');
const FRESH = '2026-09-01';

let id = 0;
const el = (name: string, amenity: string, hours: string, extra: { check_date?: string; timestamp?: string } = {}) => ({
  type: 'node', id: ++id, ...(extra.timestamp ? { timestamp: extra.timestamp } : {}),
  tags: { name, amenity, opening_hours: hours, ...(extra.check_date ? { check_date: extra.check_date } : {}) },
});
const places = (...els: ReturnType<typeof el>[]): OsmPlace[] => placesFromOverpass(els);
const opts = (day: number, holiday = false, now = NOW) => ({ day, tz: TZ, now, holiday });

describe('timesTrusted (check_date <= 12 months OR last edit <= 24 months)', () => {
  const base = { checkDate: null, editedAt: null, holidayRule: false };
  it('trusts a check_date within 12 months, not older', () => {
    expect(timesTrusted({ ...base, checkDate: '2025-12-01' }, NOW)).toBe(true);
    expect(timesTrusted({ ...base, checkDate: '2025-11-01' }, NOW)).toBe(false);
  });
  it('trusts a last edit within 24 months, not older', () => {
    expect(timesTrusted({ ...base, editedAt: '2024-12-01T00:00:00Z' }, NOW)).toBe(true);
    expect(timesTrusted({ ...base, editedAt: '2024-10-01T00:00:00Z' }, NOW)).toBe(false);
  });
  it('either one is enough: an old check_date with a recent edit is trusted', () => {
    expect(timesTrusted({ ...base, checkDate: '2020-01-01', editedAt: '2026-01-01T00:00:00Z' }, NOW)).toBe(true);
  });
  it('trusts nothing when the snapshot has neither (written before the refresh asked for them)', () => {
    expect(timesTrusted(base, NOW)).toBe(false);
  });
  it('never trusts a place read around a holiday rule', () => {
    expect(timesTrusted({ ...base, checkDate: FRESH, holidayRule: true }, NOW)).toBe(false);
  });
  it('ignores an unreadable or future check_date', () => {
    expect(timesTrusted({ ...base, checkDate: 'sometime' }, NOW)).toBe(false);
    expect(timesTrusted({ ...base, checkDate: '2031-01-01' }, NOW)).toBe(false);
  });
});

describe('openUntilLabel', () => {
  it('writes 24-hour clock times, after midnight and 24 hours', () => {
    expect(openUntilLabel({ start: 960, end: 1380 })).toBe('Open until 23:00');
    expect(openUntilLabel({ start: 960, end: 1500 })).toBe('Open until 01:00');
    expect(openUntilLabel({ start: 960, end: 1440 })).toBe('Open until 00:00');
    expect(openUntilLabel({ start: 0, end: 1440 })).toBe('Open 24 hours');
  });
});

describe('openTonightRows', () => {
  const set = places(
    el('Early Pub', 'pub', 'Mo-Su 12:00-21:00', { check_date: FRESH }),
    el('Late Bar', 'bar', 'Mo-Su 16:00-25:00', { check_date: FRESH }),
    el('Diner', 'restaurant', 'Mo-Su 11:00-23:00', { check_date: FRESH }),
    el('Lunch Only', 'restaurant', 'Mo-Su 11:00-17:30', { check_date: FRESH }),
    el('Old Data Grill', 'restaurant', 'Mo-Su 11:00-22:00', { check_date: '2019-01-01' }),
    el('Morning Cafe', 'cafe', 'Mo-Su 06:00-20:00', { check_date: FRESH }),
  );
  it('lists places open after 18:00, latest closing first, timed ones before untimed, with no cafe and no daytime-only place', () => {
    const rows = openTonightRows(set, opts(FRIDAY));
    expect(rows.map((r) => r.name)).toEqual(['Late Bar', 'Diner', 'Early Pub', 'Old Data Grill']);
  });
  it('shows "Open until HH:MM" only for recent data; old data is listed without a time', () => {
    const rows = openTonightRows(set, opts(FRIDAY));
    expect(rows.map((r) => r.closing)).toEqual(['Open until 01:00', 'Open until 23:00', 'Open until 21:00', '']);
  });
  it('carries instants for the browser sweep (close time in town time)', () => {
    const [late] = openTonightRows(set, opts(FRIDAY));
    expect(late.end).toBe('2026-11-07T08:00:00.000Z'); // 01:00 MST on Saturday
  });
  it('keeps a place with a holiday rule by its weekly pattern but never shows its time', () => {
    const p = places(el('PH Pub', 'pub', 'Mo-Sa 16:00-23:00; PH off', { check_date: FRESH }));
    const rows = openTonightRows(p, opts(FRIDAY));
    expect(rows).toHaveLength(1);
    expect(rows[0].closing).toBe('');
    expect(openTonightRows(p, opts(dayOf(2026, 11, 8)))).toEqual([]); // Sunday: closed
  });
  it('leaves out hours it cannot read (unparsed, open end, comment)', () => {
    const bad = places(el('A', 'pub', 'sunrise-sunset'), el('B', 'pub', 'Mo-Su 12:00+'), el('C', 'pub', 'Mo-Su 12:00-23:00 "kitchen to 21"'));
    expect(openTonightRows(bad, opts(FRIDAY))).toEqual([]);
  });
  it('closing after midnight sorts as later than 23:00 and reads as the next morning', () => {
    const rows = openTonightRows(places(
      el('Eleven', 'pub', 'Fr 17:00-23:00', { check_date: FRESH }),
      el('One AM', 'pub', 'Fr 17:00-01:00', { check_date: FRESH }),
      el('Two Thirty', 'pub', 'Fr 17:00-02:30', { check_date: FRESH }),
    ), opts(FRIDAY));
    expect(rows.map((r) => [r.name, r.closing])).toEqual([['Two Thirty', 'Open until 02:30'], ['One AM', 'Open until 01:00'], ['Eleven', 'Open until 23:00']]);
  });
  it('uses the right weekday (Tuesday hours, not Friday)', () => {
    const p = places(el('Weekend Bar', 'bar', 'Fr,Sa 18:00-02:00', { check_date: FRESH }));
    expect(openTonightRows(p, opts(FRIDAY))).toHaveLength(1);
    expect(openTonightRows(p, opts(TUESDAY))).toEqual([]);
  });
});

describe('holidays', () => {
  const set = places(
    el('One', 'pub', 'Mo-Su 16:00-23:00', { check_date: FRESH }),
    el('Two', 'bar', 'Mo-Su 16:00-24:00', { check_date: FRESH }),
    el('Three', 'restaurant', 'Mo-Su 16:00-22:00', { check_date: FRESH }),
  );
  it('knows the town holiday calendar', () => {
    expect(isHolidayDay('us', CHRISTMAS)).toBe(true);
    expect(isHolidayDay('us', FRIDAY)).toBe(false);
    expect(isHolidayDay('us', dayOf(2026, 11, 11))).toBe(true); // Veterans Day
    expect(isHolidayDay('us', dayOf(2026, 11, 26))).toBe(true); // Thanksgiving
    expect(isHolidayDay('gb', CHRISTMAS)).toBe(true);
    expect(isHolidayDay('gb', dayOf(2026, 11, 11))).toBe(false); // not a UK holiday
  });
  it('on a holiday: places listed, no time on any row and no instants (nothing is claimed open now)', () => {
    const rows = openTonightRows(set, opts(CHRISTMAS, true, new Date('2026-12-25T20:00:00Z')));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.closing).toBe('');
      expect(r.start).toBeUndefined();
      expect(r.end).toBeUndefined();
    }
  });
  it('no cafe "open now" list on a holiday', () => {
    const cafes = places(el('A', 'cafe', 'Mo-Su 07:00-17:00', { check_date: FRESH }), el('B', 'cafe', 'Mo-Su 07:00-17:00', { check_date: FRESH }), el('C', 'cafe', 'Mo-Su 07:00-17:00', { check_date: FRESH }));
    expect(cafeRows(cafes, opts(FRIDAY, false, new Date('2026-11-06T18:00:00Z')))).toHaveLength(3);
    expect(cafeRows(cafes, opts(CHRISTMAS, true))).toEqual([]);
  });
});

describe('openTonightSection: at least 3 places or nothing', () => {
  const three = places(
    el('One', 'pub', 'Mo-Su 16:00-23:00', { check_date: FRESH }),
    el('Two', 'bar', 'Mo-Su 16:00-24:00', { check_date: FRESH }),
    el('Three', 'restaurant', 'Mo-Su 16:00-22:00', { check_date: FRESH }),
  );
  it('three places: the section renders, all of them', () => {
    expect(openTonightSection(openTonightRows(three, opts(FRIDAY)), NOW, TZ)).toHaveLength(3);
  });
  it('two places: no section at all', () => {
    const rows = openTonightRows(three.slice(0, 2), opts(FRIDAY));
    expect(rows).toHaveLength(2);
    expect(openTonightSection(rows, NOW, TZ)).toEqual([]);
  });
  it('no places: no section', () => {
    expect(openTonightSection([], NOW, TZ)).toEqual([]);
  });
  it('places that have already closed do not count toward the 3', () => {
    const rows = openTonightRows(three, opts(FRIDAY));
    expect(openTonightSection(rows, new Date('2026-11-07T05:30:00Z'), TZ)).toEqual([]); // 22:30 local: "Three" (22:00) is over
    expect(openTonightSection(rows, new Date('2026-11-07T04:30:00Z'), TZ)).toHaveLength(3); // 21:30: all three still open
  });
});

describe('cafes', () => {
  it('are in the snapshot as their own kind but never in Open tonight', () => {
    const p = places(el('Beans', 'cafe', 'Mo-Su 06:00-23:00', { check_date: FRESH }));
    expect(p[0].kind).toBe('Cafe');
    expect(openTonightRows(p, opts(FRIDAY))).toEqual([]);
    expect(cafeRows(p, opts(FRIDAY))).toHaveLength(1);
  });
});

describe('parseOpeningHoursLoose', () => {
  it('reads around PH/SH rules and flags them', () => {
    expect(parseOpeningHoursLoose('Mo-Fr 09:00-17:00; PH off')?.holidayRule).toBe(true);
    expect(parseOpeningHoursLoose('Mo-Fr 09:00-17:00, PH off')?.holidayRule).toBe(true);
    expect(parseOpeningHoursLoose('Mo-Fr 09:00-17:00')?.holidayRule).toBe(false);
  });
  it('gives up when nothing but a holiday rule is left, or the rest is unreadable', () => {
    expect(parseOpeningHoursLoose('PH off')).toBeNull();
    expect(parseOpeningHoursLoose('sunrise-sunset; PH off')).toBeNull();
    expect(parseOpeningHoursLoose('Mo-Su 12:00+')).toBeNull();
  });
});

describe('evergreen Open late page', () => {
  const late = (n: number) => places(...Array.from({ length: n }, (_, i) => el(`Late ${i}`, 'pub', 'Fr,Sa 18:00-01:00', { check_date: FRESH })));
  it('is indexable from 5 late places, noindex below', () => {
    expect(openLatePageIndexable(late(5))).toBe(true);
    expect(openLatePageIndexable(late(4))).toBe(false);
  });
  it('counts places that close after 23:00 on some night; cafes and early closers do not count', () => {
    const p = [...late(2), ...places(el('Early', 'pub', 'Mo-Su 12:00-22:00'), el('Cafe', 'cafe', 'Mo-Su 06:00-24:00'))];
    expect(openLatePlaces(p).map((x) => x.name)).toEqual(['Late 0', 'Late 1']);
    expect(lateNights(p[0])).toEqual([{ weekday: 4, end: 1500 }, { weekday: 5, end: 1500 }]);
  });
  it('a place read around a holiday rule does not change the Open late (threshold) rows', () => {
    const p = places(el('PH Bar', 'bar', 'Mo-Su 18:00-02:00; PH off', { check_date: FRESH }));
    expect(openLateRows(p, FRIDAY, TZ)).toEqual([]);
  });
});
