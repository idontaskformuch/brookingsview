import { describe, expect, it } from 'vitest';
import {
  seasonForMonth, selectThisWeekImage, weeksCoverage, forwardCoverageWeeks,
  nextSeason, daysUntilSeasonStart, seasonPoolSizes,
  MIN_POOL_SIZE_FOR_60_DAY_RULE, RECOMMENDED_MIN_POOL_SIZE,
  type ThisWeekUsageRecord, type Season, type WeekCoverage,
} from './this-week-images';
import { THIS_WEEK_IMAGES, type ThisWeekImage } from '../config/this-week-images';
import type { Town } from '../config/category-images';

function img(id: string, seasons: Season[], townIds: Town[] = ['brookings_sd']): ThisWeekImage {
  return {
    id, path: `/assets/images/this-week/${id}.png`, alt: id, width: 1200, height: 800, seasons, town_ids: townIds,
    sourcePhotoId: 0, // unused by every test built on this helper -- only the disjointness tests below care about it, and they build their own fixtures directly
  };
}

describe('seasonForMonth (meteorological, Northern Hemisphere)', () => {
  it('maps Dec/Jan/Feb to winter', () => {
    expect(seasonForMonth(12)).toBe('winter');
    expect(seasonForMonth(1)).toBe('winter');
    expect(seasonForMonth(2)).toBe('winter');
  });

  it('maps Mar/Apr/May to spring', () => {
    expect(seasonForMonth(3)).toBe('spring');
    expect(seasonForMonth(4)).toBe('spring');
    expect(seasonForMonth(5)).toBe('spring');
  });

  it('maps Jun/Jul/Aug to summer', () => {
    expect(seasonForMonth(6)).toBe('summer');
    expect(seasonForMonth(7)).toBe('summer');
    expect(seasonForMonth(8)).toBe('summer');
  });

  it('maps Sep/Oct/Nov to autumn', () => {
    expect(seasonForMonth(9)).toBe('autumn');
    expect(seasonForMonth(10)).toBe('autumn');
    expect(seasonForMonth(11)).toBe('autumn');
  });

  it('is correct exactly at every season boundary month pair', () => {
    expect(seasonForMonth(2)).toBe('winter');
    expect(seasonForMonth(3)).toBe('spring');
    expect(seasonForMonth(5)).toBe('spring');
    expect(seasonForMonth(6)).toBe('summer');
    expect(seasonForMonth(8)).toBe('summer');
    expect(seasonForMonth(9)).toBe('autumn');
    expect(seasonForMonth(11)).toBe('autumn');
    expect(seasonForMonth(12)).toBe('winter');
  });
});

describe('selectThisWeekImage', () => {
  const NOW = new Date('2026-10-03T12:00:00Z');

  it('never picks an image whose town_ids excludes the requesting town, even when it is the only "never shown" candidate', () => {
    const pool = [
      img('brookings-only', ['autumn'], ['brookings_sd']),
      img('moval-only', ['autumn'], ['moreno_valley_ca']),
    ];
    // Both images are equally "never shown" -- without the town filter, a
    // naive implementation could still return moval-only for brookings_sd.
    const result = selectThisWeekImage(pool, 'brookings_sd', 'autumn', [], '2026-w40', NOW);
    expect(result).toBe('brookings-only');
  });

  it('returns null (never a silent fallback) when every eligible image was shown within the last 60 days', () => {
    const pool = [img('only-winter', ['winter'])];
    const history: ThisWeekUsageRecord[] = [
      { imageId: 'only-winter', shownAt: new Date('2026-09-20T00:00:00Z') }, // 13 days before NOW
    ];
    expect(selectThisWeekImage(pool, 'brookings_sd', 'winter', history, '2026-w40', NOW)).toBeNull();
  });

  it('returns null when the pool has no entry at all for this town+season', () => {
    const pool = [img('summer-only', ['summer'])];
    expect(selectThisWeekImage(pool, 'brookings_sd', 'winter', [], '2026-w40', NOW)).toBeNull();
  });

  it('picks an image again once it clears the 60-day window', () => {
    const pool = [img('only-winter', ['winter'])];
    const history: ThisWeekUsageRecord[] = [
      { imageId: 'only-winter', shownAt: new Date('2026-07-01T00:00:00Z') }, // 94 days before NOW
    ];
    expect(selectThisWeekImage(pool, 'brookings_sd', 'winter', history, '2026-w40', NOW)).toBe('only-winter');
  });

  it('prefers the least-recently-shown eligible image over a more recently shown one', () => {
    const pool = [img('a', ['autumn']), img('b', ['autumn'])];
    const history: ThisWeekUsageRecord[] = [
      { imageId: 'a', shownAt: new Date('2026-08-01T00:00:00Z') }, // older
      { imageId: 'b', shownAt: new Date('2026-08-20T00:00:00Z') }, // more recent
    ];
    // Neither is within 60 days of NOW, so both are eligible -- 'a' is the
    // longer-ago pick and should win.
    expect(selectThisWeekImage(pool, 'brookings_sd', 'autumn', history, '2026-w40', NOW)).toBe('a');
  });

  it('prefers a never-shown image over any previously-shown one, even an old one', () => {
    const pool = [img('shown-long-ago', ['autumn']), img('never-shown', ['autumn'])];
    const history: ThisWeekUsageRecord[] = [
      { imageId: 'shown-long-ago', shownAt: new Date('2026-01-01T00:00:00Z') },
    ];
    expect(selectThisWeekImage(pool, 'brookings_sd', 'autumn', history, '2026-w40', NOW)).toBe('never-shown');
  });

  it('is deterministic -- the same inputs always produce the same pick (stable on a same-week rebuild)', () => {
    const pool = [img('a', ['autumn']), img('b', ['autumn']), img('c', ['autumn'])];
    const first = selectThisWeekImage(pool, 'brookings_sd', 'autumn', [], '2026-w40', NOW);
    const second = selectThisWeekImage(pool, 'brookings_sd', 'autumn', [], '2026-w40', NOW);
    expect(first).toBe(second);
  });

  it('breaks a tie among equally-eligible candidates differently for a different iso week (not always index 0)', () => {
    const pool = [img('a', ['autumn']), img('b', ['autumn']), img('c', ['autumn']), img('d', ['autumn'])];
    const picks = new Set(
      ['2026-w01', '2026-w02', '2026-w03', '2026-w04', '2026-w05', '2026-w06'].map(
        (week) => selectThisWeekImage(pool, 'brookings_sd', 'autumn', [], week, NOW),
      ),
    );
    // Not asserting a specific distribution, just that the tie-break isn't
    // a no-op that always returns the pool's first entry regardless of week.
    expect(picks.size).toBeGreaterThan(1);
  });

  it('simulated 52-week run never repeats an image within 60 days, for a realistic 13-image seasonal pool', () => {
    // Mirrors the brief's own minimum (13 approved images per season).
    const seasons: Season[] = ['winter', 'spring', 'summer', 'autumn'];
    const pool: ThisWeekImage[] = seasons.flatMap((season) =>
      Array.from({ length: 13 }, (_, i) => img(`${season}-${i + 1}`, [season])),
    );

    const history: ThisWeekUsageRecord[] = [];
    const start = new Date('2026-01-05T12:00:00Z'); // a Monday
    for (let week = 0; week < 52; week++) {
      const now = new Date(start.getTime() + week * 7 * 86_400_000);
      const month = now.getUTCMonth() + 1;
      const season = seasonForMonth(month);
      const isoYearWeek = `sim-w${week}`;
      const chosen = selectThisWeekImage(pool, 'brookings_sd', season, history, isoYearWeek, now);
      expect(chosen).not.toBeNull();

      // Assert the 60-day rule directly: whatever was chosen must not
      // appear anywhere in the last 60 days of history.
      const cutoff = now.getTime() - 60 * 86_400_000;
      const violatesRule = history.some((h) => h.imageId === chosen && h.shownAt.getTime() >= cutoff);
      expect(violatesRule).toBe(false);

      history.push({ imageId: chosen!, shownAt: now });
    }
  });

  it('does not leak an image between two different towns\' independent usage histories', () => {
    // Same image id nominally available to both towns (shared town_ids) --
    // Brookings using it recently must not block Moreno Valley from using
    // it too, since each town's own history should be checked independently
    // by the caller (db.ts's resolveThisWeekImage() only ever fetches ONE
    // town's rows) -- this test documents that the pure function itself
    // makes no town-scoping assumption about the `history` it's handed.
    const pool = [img('shared', ['autumn'], ['brookings_sd', 'moreno_valley_ca'])];
    const brookingsHistory: ThisWeekUsageRecord[] = [{ imageId: 'shared', shownAt: new Date('2026-09-25T00:00:00Z') }];
    expect(selectThisWeekImage(pool, 'brookings_sd', 'autumn', brookingsHistory, '2026-w40', NOW)).toBeNull();
    expect(selectThisWeekImage(pool, 'moreno_valley_ca', 'autumn', [], '2026-w40', NOW)).toBe('shared');
  });
});

describe('weeksCoverage', () => {
  const WEEKS_OCT_NOV = [
    { isoYearWeek: '2026-w40', month: 10 }, // autumn
    { isoYearWeek: '2026-w41', month: 10 }, // autumn
    { isoYearWeek: '2026-w48', month: 11 }, // autumn
    { isoYearWeek: '2026-w49', month: 12 }, // winter -- crosses the season boundary
  ];

  it('reports zero for every week when the pool is empty -- the real state of config/this-week-images.ts today', () => {
    const coverage = weeksCoverage([], 'brookings_sd', WEEKS_OCT_NOV);
    expect(coverage).toEqual([
      { isoYearWeek: '2026-w40', season: 'autumn', poolSize: 0 },
      { isoYearWeek: '2026-w41', season: 'autumn', poolSize: 0 },
      { isoYearWeek: '2026-w48', season: 'autumn', poolSize: 0 },
      { isoYearWeek: '2026-w49', season: 'winter', poolSize: 0 },
    ]);
  });

  it('counts only images matching both this town and that week\'s season', () => {
    const pool = [
      img('a', ['autumn'], ['brookings_sd']),
      img('b', ['autumn'], ['brookings_sd']),
      img('c', ['autumn'], ['moreno_valley_ca']), // wrong town
      img('d', ['winter'], ['brookings_sd']), // wrong season for w40
    ];
    const coverage = weeksCoverage(pool, 'brookings_sd', [{ isoYearWeek: '2026-w40', month: 10 }]);
    expect(coverage).toEqual([{ isoYearWeek: '2026-w40', season: 'autumn', poolSize: 2 }]);
  });

  it('resolves the season from each week\'s own month, correctly crossing a season boundary mid-list', () => {
    const pool = [img('autumn-1', ['autumn']), img('winter-1', ['winter'])];
    const coverage = weeksCoverage(pool, 'brookings_sd', WEEKS_OCT_NOV);
    expect(coverage.map((w) => w.season)).toEqual(['autumn', 'autumn', 'autumn', 'winter']);
    expect(coverage.map((w) => w.poolSize)).toEqual([1, 1, 1, 1]);
  });

  it('returns an empty array for an empty weeks input', () => {
    expect(weeksCoverage([img('a', ['autumn'])], 'brookings_sd', [])).toEqual([]);
  });
});

describe('nextSeason', () => {
  it('cycles winter -> spring -> summer -> autumn -> winter', () => {
    expect(nextSeason('winter')).toBe('spring');
    expect(nextSeason('spring')).toBe('summer');
    expect(nextSeason('summer')).toBe('autumn');
    expect(nextSeason('autumn')).toBe('winter');
  });
});

describe('daysUntilSeasonStart', () => {
  it('is 0 on the season\'s own start date', () => {
    expect(daysUntilSeasonStart(12, 1, 'winter')).toBe(0);
    expect(daysUntilSeasonStart(3, 1, 'spring')).toBe(0);
    expect(daysUntilSeasonStart(6, 1, 'summer')).toBe(0);
    expect(daysUntilSeasonStart(9, 1, 'autumn')).toBe(0);
  });

  it('counts down correctly in the lead-up to a shift', () => {
    expect(daysUntilSeasonStart(11, 20, 'winter')).toBe(11); // Nov 20 -> Dec 1
    expect(daysUntilSeasonStart(11, 1, 'winter')).toBe(30); // exactly 30 days out
    expect(daysUntilSeasonStart(10, 31, 'winter')).toBe(31); // one day earlier -> 31, not 30
  });

  it('wraps FORWARD across a year boundary rather than counting backward', () => {
    // Today is in winter (Jan 15); asking about winter's own start date
    // means "next winter," not the Dec 1 that already passed -- callers
    // only ever ask about the season AFTER the current one in practice
    // (see seasonPoolSizes), but the math must still wrap correctly.
    expect(daysUntilSeasonStart(1, 15, 'winter')).toBe(320); // Jan 15 -> next Dec 1
  });

  it('is year-agnostic -- same answer regardless of which real year it is called in', () => {
    // No year parameter exists at all; this just documents that Dec 31 ->
    // Mar 1 wraparound math (via the fixed non-leap reference year) stays
    // correct right at the calendar-year rollover.
    expect(daysUntilSeasonStart(12, 31, 'spring')).toBe(daysUntilSeasonStart(12, 31, 'spring'));
    expect(daysUntilSeasonStart(12, 31, 'spring')).toBe(60); // Dec 31 -> Mar 1
  });
});

describe('seasonPoolSizes', () => {
  const poolWithSizes = (autumn: number, winter: number): ThisWeekImage[] => [
    ...Array.from({ length: autumn }, (_, i) => img(`autumn-${i}`, ['autumn'])),
    ...Array.from({ length: winter }, (_, i) => img(`winter-${i}`, ['winter'])),
  ];

  it('reports only the current season when the next season\'s start is outside the shift window', () => {
    // Oct 15: autumn, winter starts Dec 1 (~47 days out) -- well outside a
    // 30-day window.
    const result = seasonPoolSizes(poolWithSizes(10, 20), 'brookings_sd', 10, 15, 30);
    expect(result).toEqual([{ season: 'autumn', scope: 'current', poolSize: 10 }]);
  });

  it('additionally reports the next season once today is within the shift window', () => {
    // Nov 20: autumn, winter starts Dec 1 (11 days out) -- inside a 30-day window.
    const result = seasonPoolSizes(poolWithSizes(10, 20), 'brookings_sd', 11, 20, 30);
    expect(result).toEqual([
      { season: 'autumn', scope: 'current', poolSize: 10 },
      { season: 'winter', scope: 'next', poolSize: 20 },
    ]);
  });

  it('includes the next season exactly at the boundary (daysUntilSeasonStart === daysBeforeShift)', () => {
    // Nov 1 -> Dec 1 is exactly 30 days.
    const result = seasonPoolSizes(poolWithSizes(10, 20), 'brookings_sd', 11, 1, 30);
    expect(result.map((r) => r.scope)).toEqual(['current', 'next']);
  });

  it('excludes the next season one day outside the boundary', () => {
    // Oct 31 -> Dec 1 is 31 days, one more than the 30-day window.
    const result = seasonPoolSizes(poolWithSizes(10, 20), 'brookings_sd', 10, 31, 30);
    expect(result.map((r) => r.scope)).toEqual(['current']);
  });

  it('only counts images matching the requesting town', () => {
    const pool = [img('a', ['autumn'], ['brookings_sd']), img('b', ['autumn'], ['moreno_valley_ca'])];
    const result = seasonPoolSizes(pool, 'brookings_sd', 10, 15, 30);
    expect(result).toEqual([{ season: 'autumn', scope: 'current', poolSize: 1 }]);
  });

  it('documents the two real thresholds this feeds into (MIN_POOL_SIZE_FOR_60_DAY_RULE=9, RECOMMENDED_MIN_POOL_SIZE=13)', () => {
    expect(MIN_POOL_SIZE_FOR_60_DAY_RULE).toBe(9);
    expect(RECOMMENDED_MIN_POOL_SIZE).toBe(13);
  });

  it.each([
    [8, 'below the 60-day-rule minimum'],
    [9, 'at the 60-day-rule minimum, still below the recommended minimum'],
    [12, 'just below the recommended minimum'],
    [13, 'at the recommended minimum'],
    [20, 'comfortably above both'],
  ])('reports the real pool size of %i unmodified (%s) -- build-checks.ts applies the thresholds', (size) => {
    const result = seasonPoolSizes(poolWithSizes(size, 0), 'brookings_sd', 10, 15, 30);
    expect(result[0].poolSize).toBe(size);
    expect(result[0].poolSize < MIN_POOL_SIZE_FOR_60_DAY_RULE).toBe(size < 9);
    expect(result[0].poolSize < RECOMMENDED_MIN_POOL_SIZE).toBe(size < 13);
  });
});

describe('forwardCoverageWeeks', () => {
  const week = (poolSize: number, isoYearWeek = '2026-w40', season: Season = 'autumn'): WeekCoverage => (
    { isoYearWeek, season, poolSize }
  );

  it('returns the full length when every week has at least one image', () => {
    expect(forwardCoverageWeeks([week(3), week(1), week(5)])).toBe(3);
  });

  it('returns 0 when the current (first) week is already empty', () => {
    expect(forwardCoverageWeeks([week(0), week(5), week(5)])).toBe(0);
  });

  it('stops counting at the first empty week, even when a later week has images -- a later pick cannot un-gap an earlier one', () => {
    expect(forwardCoverageWeeks([week(3), week(3), week(0), week(5)])).toBe(2);
  });

  it('returns 0 for an empty coverage list', () => {
    expect(forwardCoverageWeeks([])).toBe(0);
  });
});

describe('THIS_WEEK_IMAGES pool disjointness (2026-10-03 review instruction)', () => {
  it('never assigns the same source Pexels photo to more than one town', () => {
    // Runs against the REAL config, not a synthetic fixture -- the pool is
    // empty today, so this is a forward guard, not a current-state check:
    // once scripts/source_this_week_images.py --apply populates it, the
    // same real photo must never end up serving two different towns (both
    // weakens "this town, this week" distinctiveness and leaves no trace
    // it happened once two separately-downloaded files exist under two
    // town-prefixed paths -- see sourcePhotoId's own doc comment).
    const townsForPhoto = new Map<number, Set<string>>();
    for (const img of THIS_WEEK_IMAGES) {
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
    const fixture: ThisWeekImage[] = [
      { id: 'brookings_sd-autumn-01', path: '/a.png', alt: 'a', width: 1200, height: 800, seasons: ['autumn'], town_ids: ['brookings_sd'], sourcePhotoId: 999 },
      { id: 'broomfield_co-autumn-01', path: '/b.png', alt: 'b', width: 1200, height: 800, seasons: ['autumn'], town_ids: ['broomfield_co'], sourcePhotoId: 999 },
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
