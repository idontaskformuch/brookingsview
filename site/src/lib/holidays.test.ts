import { describe, expect, it } from 'vitest';
import {
  computeHolidayDate, holidayWindow, resolveActiveHoliday, selectHolidayImage, holidayPoolSizesDueSoon,
  type DateYMD,
} from './holidays';
import { selectThisWeekImage, type ThisWeekUsageRecord } from './this-week-images';
import { HOLIDAYS, HOLIDAY_IMAGES, type HolidayDefinition, type HolidayImage, type HolidayId } from '../config/holidays';
import type { Town } from '../config/category-images';
import type { ThisWeekImage } from '../config/this-week-images';

function holidayImg(id: string, holiday: HolidayId, townIds: Town[] = ['brookings_sd']): HolidayImage {
  return {
    id, path: `/assets/images/holidays/${id}.jpg`, alt: id, width: 1200, height: 800,
    holiday, town_ids: townIds, sourcePhotoId: 0,
  };
}

describe('computeHolidayDate', () => {
  it('resolves a fixed-date holiday the same every year', () => {
    expect(computeHolidayDate({ kind: 'fixed', month: 10, day: 31 }, 2026)).toEqual({ y: 2026, m: 10, d: 31 });
    expect(computeHolidayDate({ kind: 'fixed', month: 10, day: 31 }, 2027)).toEqual({ y: 2027, m: 10, d: 31 });
  });

  it('resolves Thanksgiving (4th Thursday of November) correctly across several years', () => {
    // Verified against real calendar dates.
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 11, weekday: 4, n: 4 }, 2026)).toEqual({ y: 2026, m: 11, d: 26 });
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 11, weekday: 4, n: 4 }, 2027)).toEqual({ y: 2027, m: 11, d: 25 });
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 11, weekday: 4, n: 4 }, 2025)).toEqual({ y: 2025, m: 11, d: 27 });
  });

  it('resolves Labor Day (1st Monday of September)', () => {
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 9, weekday: 1, n: 1 }, 2026)).toEqual({ y: 2026, m: 9, d: 7 });
  });

  it('resolves Memorial Day (LAST Monday of May, negative n)', () => {
    // 2026: May has 31 days, May 31 is a Sunday -> last Monday is May 25.
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 5, weekday: 1, n: -1 }, 2026)).toEqual({ y: 2026, m: 5, d: 25 });
    // 2027: May 31 is a Monday -> last Monday IS May 31.
    expect(computeHolidayDate({ kind: 'nth_weekday', month: 5, weekday: 1, n: -1 }, 2027)).toEqual({ y: 2027, m: 5, d: 31 });
  });

  it('resolves Easter via Computus against known real dates, including a late-March year', () => {
    expect(computeHolidayDate({ kind: 'easter' }, 2026)).toEqual({ y: 2026, m: 4, d: 5 });
    expect(computeHolidayDate({ kind: 'easter' }, 2025)).toEqual({ y: 2025, m: 4, d: 20 });
    expect(computeHolidayDate({ kind: 'easter' }, 2027)).toEqual({ y: 2027, m: 3, d: 28 });
    expect(computeHolidayDate({ kind: 'easter' }, 2024)).toEqual({ y: 2024, m: 3, d: 31 });
  });
});

describe('holidayWindow', () => {
  it('opens windowDays before the holiday and runs through the holiday date, inclusive', () => {
    const def: HolidayDefinition = { id: 'halloween', label: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 }, windowDays: 7, active: true };
    expect(holidayWindow(def, 2026)).toEqual({ start: { y: 2026, m: 10, d: 24 }, end: { y: 2026, m: 10, d: 31 } });
  });

  it('can open in the PREVIOUS calendar year (New Year\'s Day)', () => {
    const def: HolidayDefinition = { id: 'new_years', label: "New Year's", dateRule: { kind: 'fixed', month: 1, day: 1 }, windowDays: 3, active: false };
    expect(holidayWindow(def, 2026)).toEqual({ start: { y: 2025, m: 12, d: 29 }, end: { y: 2026, m: 1, d: 1 } });
  });
});

describe('resolveActiveHoliday', () => {
  const halloween: HolidayDefinition = { id: 'halloween', label: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 }, windowDays: 7, active: true };
  const thanksgiving: HolidayDefinition = { id: 'thanksgiving', label: 'Thanksgiving', dateRule: { kind: 'nth_weekday', month: 11, weekday: 4, n: 4 }, windowDays: 7, active: true };
  const inactive: HolidayDefinition = { id: 'new_years', label: "New Year's", dateRule: { kind: 'fixed', month: 1, day: 1 }, windowDays: 30, active: false };

  it('returns the holiday whose window the week falls inside', () => {
    // 2026-w44: Monday Oct 26 -> Sunday Nov 1 -- squarely inside Halloween's Oct 24-31 window.
    const result = resolveActiveHoliday([halloween, thanksgiving], { y: 2026, m: 10, d: 26 }, { y: 2026, m: 11, d: 1 });
    expect(result?.holiday).toBe('halloween');
  });

  it('returns null for a week with no overlapping active window', () => {
    // Mid-July -- nowhere near Halloween or Thanksgiving.
    const result = resolveActiveHoliday([halloween, thanksgiving], { y: 2026, m: 7, d: 13 }, { y: 2026, m: 7, d: 19 });
    expect(result).toBeNull();
  });

  it('never matches an INACTIVE holiday even when its window would otherwise overlap', () => {
    // The week containing New Year's Day, but new_years is active: false.
    const result = resolveActiveHoliday([halloween, thanksgiving, inactive], { y: 2025, m: 12, d: 29 }, { y: 2026, m: 1, d: 4 });
    expect(result).toBeNull();
  });

  it('breaks a tie between two overlapping active windows by picking the CLOSER holiday date', () => {
    // Two synthetic holidays with long, overlapping windows -- the week
    // sits closer to "near" than to "far".
    const near: HolidayDefinition = { id: 'halloween', label: 'Near', dateRule: { kind: 'fixed', month: 6, day: 10 }, windowDays: 20, active: true };
    const far: HolidayDefinition = { id: 'thanksgiving', label: 'Far', dateRule: { kind: 'fixed', month: 6, day: 25 }, windowDays: 20, active: true };
    // Week of June 5-11: 5 days before "near" (Jun 10), 14+ days before "far" (Jun 25).
    const result = resolveActiveHoliday([near, far], { y: 2026, m: 6, d: 5 }, { y: 2026, m: 6, d: 11 });
    expect(result?.holiday).toBe('halloween'); // "near"'s id
  });

  it('the real HOLIDAYS catalog correctly resolves the week of 2026-10-26..11-01 to halloween', () => {
    const result = resolveActiveHoliday(HOLIDAYS, { y: 2026, m: 10, d: 26 }, { y: 2026, m: 11, d: 1 });
    expect(result?.holiday).toBe('halloween');
  });
});

describe('selectHolidayImage', () => {
  const NOW = new Date('2026-10-28T12:00:00Z');

  it('picks from the holiday pool, town-scoped, same as the season selector', () => {
    const pool = [holidayImg('a', 'halloween', ['brookings_sd']), holidayImg('b', 'halloween', ['moreno_valley_ca'])];
    expect(selectHolidayImage(pool, 'brookings_sd', 'halloween', [], '2026-w44', NOW)).toBe('a');
  });

  it('never picks a different holiday\'s image even for the same town', () => {
    const pool = [holidayImg('a', 'thanksgiving')];
    expect(selectHolidayImage(pool, 'brookings_sd', 'halloween', [], '2026-w44', NOW)).toBeNull();
  });

  it('respects the 60-day no-repeat rule', () => {
    const pool = [holidayImg('only', 'halloween')];
    const history: ThisWeekUsageRecord[] = [{ imageId: 'only', shownAt: new Date('2026-10-01T00:00:00Z') }]; // 27 days before NOW
    expect(selectHolidayImage(pool, 'brookings_sd', 'halloween', history, '2026-w44', NOW)).toBeNull();
  });

  it('returns null, never a silent fallback, when the pool is empty for this town', () => {
    expect(selectHolidayImage([], 'brookings_sd', 'halloween', [], '2026-w44', NOW)).toBeNull();
  });
});

describe('60-day rule holds across a holiday window embedded in the season pool', () => {
  it('a season image shown just before a holiday week, then the holiday week, then back to season -- no 60-day violation on either track', () => {
    const seasonPool: ThisWeekImage[] = [
      { id: 'autumn-only', path: '/a.png', alt: 'a', width: 1200, height: 800, seasons: ['autumn'], town_ids: ['brookings_sd'], sourcePhotoId: 1 },
      { id: 'autumn-only-2', path: '/b.png', alt: 'b', width: 1200, height: 800, seasons: ['autumn'], town_ids: ['brookings_sd'], sourcePhotoId: 2 },
    ];
    const holidayPool: HolidayImage[] = [holidayImg('hw-only', 'halloween')];

    // Shared history, exactly like the real this_week_image_usage table --
    // season and holiday picks both land in the same array/table.
    const history: (ThisWeekUsageRecord & { kind: 'season' | 'holiday' })[] = [];

    // Week 1 (season, before the Halloween window): picks an autumn image.
    const w1 = new Date('2026-10-12T00:00:00Z');
    const pick1 = selectThisWeekImage(seasonPool, 'brookings_sd', 'autumn', history, '2026-w42', w1);
    expect(pick1).not.toBeNull();
    history.push({ imageId: pick1!, shownAt: w1, kind: 'season' });

    // Week 3 (holiday window): picks the holiday image -- entirely separate
    // id space, so the season pick above has no bearing on it.
    const w3 = new Date('2026-10-26T00:00:00Z');
    const pickHoliday = selectHolidayImage(holidayPool, 'brookings_sd', 'halloween', history, '2026-w44', w3);
    expect(pickHoliday).toBe('hw-only');
    history.push({ imageId: pickHoliday!, shownAt: w3, kind: 'holiday' });

    // Week 4 (back to season, only 7 days after week 1's pick -- still
    // within 60 days): the SAME season image must NOT be re-eligible,
    // proving the holiday week in between didn't reset or corrupt the
    // season pool's own 60-day tracking.
    const w4 = new Date('2026-11-02T00:00:00Z');
    const pick4 = selectThisWeekImage(seasonPool, 'brookings_sd', 'autumn', history, '2026-w45', w4);
    expect(pick4).toBe('autumn-only-2'); // the OTHER season image, not a repeat of pick1
    expect(pick4).not.toBe(pick1);
  });
});

describe('holidayPoolSizesDueSoon', () => {
  const halloween: HolidayDefinition = { id: 'halloween', label: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 }, windowDays: 7, active: true };

  it('reports the pool size once today falls within daysBeforeWindow of the window START', () => {
    // Window starts Oct 24; 30 days before that is Sep 24.
    const pool = [holidayImg('a', 'halloween'), holidayImg('b', 'halloween')];
    const today: DateYMD = { y: 2026, m: 9, d: 24 };
    const result = holidayPoolSizesDueSoon([halloween], pool, 'brookings_sd', today, 30);
    expect(result).toEqual([{ holiday: 'halloween', windowStart: { y: 2026, m: 10, d: 24 }, poolSize: 2 }]);
  });

  it('reports nothing when today is more than daysBeforeWindow away from every active window', () => {
    const today: DateYMD = { y: 2026, m: 6, d: 1 }; // nowhere near Halloween
    const result = holidayPoolSizesDueSoon([halloween], [], 'brookings_sd', today, 30);
    expect(result).toEqual([]);
  });

  it('never reports an inactive holiday', () => {
    const inactive: HolidayDefinition = { id: 'christmas', label: 'X', dateRule: { kind: 'fixed', month: 12, day: 25 }, windowDays: 14, active: false };
    const today: DateYMD = { y: 2026, m: 12, d: 1 };
    expect(holidayPoolSizesDueSoon([inactive], [], 'brookings_sd', today, 30)).toEqual([]);
  });
});

describe('HOLIDAY_IMAGES pool disjointness (same rule as THIS_WEEK_IMAGES -- 2026-10-06 review instruction)', () => {
  it('never assigns the same source Pexels photo to more than one town', () => {
    // Runs against the REAL config, not a synthetic fixture -- the pool is
    // empty today, so this is a forward guard, same reasoning as the
    // equivalent THIS_WEEK_IMAGES test in this-week-images.test.ts.
    const townsForPhoto = new Map<number, Set<string>>();
    for (const img of HOLIDAY_IMAGES) {
      const towns = townsForPhoto.get(img.sourcePhotoId) ?? new Set<string>();
      for (const t of img.town_ids) towns.add(t);
      townsForPhoto.set(img.sourcePhotoId, towns);
    }
    const violations = [...townsForPhoto.entries()]
      .filter(([, towns]) => towns.size > 1)
      .map(([sourcePhotoId, towns]) => `sourcePhotoId=${sourcePhotoId} used by: ${[...towns].join(', ')}`);
    expect(violations).toEqual([]);
  });

  it('flags a synthetic violation correctly -- the check itself is not a no-op', () => {
    // Both default to sourcePhotoId: 0 via the holidayImg() helper -- a
    // real collision (same underlying photo, two different towns).
    const fixture: HolidayImage[] = [
      holidayImg('brookings_sd-halloween-01', 'halloween', ['brookings_sd']),
      holidayImg('broomfield_co-halloween-01', 'halloween', ['broomfield_co']),
    ];
    const townsForPhoto = new Map<number, Set<string>>();
    for (const img of fixture) {
      const towns = townsForPhoto.get(img.sourcePhotoId) ?? new Set<string>();
      for (const t of img.town_ids) towns.add(t);
      townsForPhoto.set(img.sourcePhotoId, towns);
    }
    const violations = [...townsForPhoto.entries()].filter(([, towns]) => towns.size > 1);
    expect(violations.length).toBe(1);
  });
});
