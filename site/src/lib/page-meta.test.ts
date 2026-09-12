import { describe, expect, it } from 'vitest';
import { resolvePageMeta } from './page-meta';
import { PAGE_META_PATTERNS } from '../config/page-meta';

const BROOKINGS = { townId: 'brookings_sd', cityName: 'Brookings', siteName: 'Brookings View' };
const MORENO_VALLEY = { townId: 'moreno_valley_ca', cityName: 'Moreno Valley', siteName: 'Moreno Valley View' };
const BROOMFIELD = { townId: 'broomfield_co', cityName: 'Broomfield', siteName: 'Broomfield View' };
const ALL_TOWNS = [BROOKINGS, MORENO_VALLEY, BROOMFIELD];

describe('resolvePageMeta', () => {
  it('interpolates {Town} and {Site} into the shared pattern', () => {
    const result = resolvePageMeta('city-hall', MORENO_VALLEY);
    expect(result.title).toBe('Moreno Valley Council Meetings, Summarized | Moreno Valley View');
    expect(result.h1).toBe('Moreno Valley City Hall: Council and Planning Meetings in Plain Language');
  });

  it('uses a pipe separator, never the sitewide no-em-dash rule\'s old em-dash', () => {
    const result = resolvePageMeta('city-hall', BROOKINGS);
    expect(result.title).toContain(' | ');
    expect(result.title).not.toContain('—');
  });

  // CORRECTION (post-Phase-1 discovery): /sports/ and /jackrabbits/ are two
  // entirely separate pages (site/src/pages/sports.astro is Moreno-Valley-
  // only; site/src/pages/jackrabbits.astro is Brookings-only), not one
  // shared route with a per-town H1 override as the handoff assumed -- see
  // page-meta.ts's own correction comment on the `sports`/`jackrabbits`
  // entries. There is no TOWN_OVERRIDES entry for either key anymore.
  it('resolves the sports pattern with its own regional-affiliate framing (Moreno Valley is the only real caller)', () => {
    const result = resolvePageMeta('sports', MORENO_VALLEY);
    expect(result.h1).toContain('Regional');
    expect(result.h1).not.toContain('Jackrabbits');
  });

  it('resolves the jackrabbits pattern with the SDSU framing (Brookings is the only real caller)', () => {
    const result = resolvePageMeta('jackrabbits', BROOKINGS);
    expect(result.h1).toContain('Jackrabbits');
    expect(result.h1).toContain('Brookings');
  });

  it('falls back to the shared base pattern for a town with no override (Broomfield has neither /sports/ nor /jackrabbits/, but the fallback itself must still resolve cleanly if ever called)', () => {
    const result = resolvePageMeta('sports', BROOMFIELD);
    expect(result.h1).toBe('Broomfield-Area Sports: Regional and Affiliate Team Scores');
  });

  it('interpolates an extraVars placeholder for facility detail', () => {
    const result = resolvePageMeta('facilities/detail', BROOMFIELD, { FacilityName: 'Mamie Doud Eisenhower Public Library' });
    expect(result.title).toBe('Mamie Doud Eisenhower Public Library | Broomfield View');
    expect(result.h1).toBe("Mamie Doud Eisenhower Public Library: Hours, Location and What's There");
  });

  it('throws for an unregistered route key -- a typo\'d call site, not a normal per-town gap', () => {
    expect(() => resolvePageMeta('not-a-real-route', BROOKINGS)).toThrow(/no pattern registered/);
  });

  it('throws if a pattern references a placeholder with no supplied value', () => {
    expect(() => resolvePageMeta('facilities/detail', BROOKINGS)).toThrow(/unknown placeholder \{FacilityName\}/);
  });

  // The real bug this catches: every pattern was hand-checked against
  // "Moreno Valley" (13 chars, the longest of the three real town names)
  // during Phase 1 -- several of the handoff's own literal example
  // strings exceeded 65 chars for it even though they fit Brookings/
  // Broomfield fine (see page-meta.ts's own calibration comment). This
  // test is what would have caught that automatically instead of by hand.
  it('every registered pattern (except the known facility-detail/this-week exceptions) stays <= 65 chars for every real town', () => {
    const overflows: string[] = [];
    for (const routeKey of Object.keys(PAGE_META_PATTERNS)) {
      // documented exceptions, see page-meta.ts's own calibration comments --
      // both also require an extraVar this generic sweep doesn't supply.
      if (routeKey === 'facilities/detail' || routeKey === 'this-week') continue;
      for (const town of ALL_TOWNS) {
        const { title } = resolvePageMeta(routeKey, town);
        if (title.length > 65) overflows.push(`${routeKey} / ${town.cityName}: ${title.length} chars ("${title}")`);
      }
    }
    expect(overflows).toEqual([]);
  });

  it('facility-detail stays <= 65 chars for a realistically-named facility, even if not the longest outlier', () => {
    const result = resolvePageMeta('facilities/detail', MORENO_VALLEY, { FacilityName: 'Woodland Park' });
    expect(result.title.length).toBeLessThanOrEqual(65);
  });

  it('this-week stays <= 65 chars for an ordinary (non-year-boundary) week label', () => {
    const result = resolvePageMeta('this-week', MORENO_VALLEY, { WeekLabel: 'September 8-14, 2026' });
    expect(result.title.length).toBeLessThanOrEqual(65);
    expect(result.h1).toContain('Moreno Valley');
  });

  it('this-week is the documented exception for a year-boundary week label', () => {
    // Real formatWeekLabel() output (site/src/lib/this-week.ts) for the one
    // ISO week per year that crosses a calendar year -- see page-meta.ts's
    // own comment on this entry for why this isn't fixed by rewording.
    const result = resolvePageMeta('this-week', MORENO_VALLEY, { WeekLabel: 'December 29, 2025 - January 4, 2026' });
    expect(result.title.length).toBeGreaterThan(65);
  });

  it('this-week stays <= 65 chars for a month-crossing (but not year-crossing) week label', () => {
    // The real regression page_meta_check caught live on a real Moreno
    // Valley build: a week label spanning two month names (roughly one
    // week in four, not a once-a-year rarity) also overflowed 65 chars
    // under the old '{Town}: Week of {WeekLabel} | {Site}' pattern --
    // "Moreno Valley: Week of July 27-August 2, 2026 | Moreno Valley
    // View" was 66 chars. Dropping "Week of" fixed it -- see page-meta.ts's
    // own comment on this entry.
    const result = resolvePageMeta('this-week', MORENO_VALLEY, { WeekLabel: 'July 27-August 2, 2026' });
    expect(result.title.length).toBeLessThanOrEqual(65);
  });
});
