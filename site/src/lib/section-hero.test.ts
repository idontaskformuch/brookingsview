import { describe, expect, it } from 'vitest';
import { getSectionHero, sectionsFor, sectionHeroGapWeeks, slotIndex, type HeroSection, type PoolImage } from './section-hero';
import { thisWeekImagesFor } from '../config/this-week-images';
import { HOLIDAYS, holidayImagesFor } from '../config/holidays';
import { resolveActiveHoliday } from './holidays';
import { weekInfoForInstant } from './this-week';
import { seasonForMonth } from './this-week-images';

const TOWNS = ['brookings_sd', 'moreno_valley_ca', 'broomfield_co'] as const;
const TZ: Record<string, string> = { brookings_sd: 'America/Chicago', moreno_valley_ca: 'America/Los_Angeles', broomfield_co: 'America/Denver' };

/** Noon UTC on the Wednesday of each of the next `weeks` weeks from 2026-10-21. */
function weekDates(weeks: number): Date[] {
  return Array.from({ length: weeks }, (_, i) => new Date(Date.UTC(2026, 9, 21 + 7 * i, 12)));
}

function img(id: string): PoolImage {
  return { id, path: `/x/${id}.jpg`, alt: id, width: 1200, height: 800 };
}

/** A stand-in for the homepage's own pick: whatever the real pool would give section slot 0, +1. */
function homepagePick(town: string, date: Date): string | null {
  const w = weekInfoForInstant(date, TZ[town]);
  const season = seasonForMonth(w.monday.m);
  const holiday = resolveActiveHoliday(HOLIDAYS, w.monday, w.sunday);
  const pool: { id: string }[] = [...(holiday ? holidayImagesFor(town, holiday.holiday) : []), ...thisWeekImagesFor(town).filter((i) => i.seasons.includes(season))];
  return pool.length ? pool[(w.isoWeek * 7) % pool.length].id : null;
}

describe('getSectionHero (real pools, 10 weeks forward from 2026-10-21)', () => {
  for (const town of TOWNS) {
    const sections = sectionsFor(town);
    it(`${town}: deterministic, section-distinct and never the homepage image each week`, () => {
      for (const date of weekDates(10)) {
        const hp = homepagePick(town, date);
        const run = () => sections.map((s) => getSectionHero(town, s, date, { homepageImageId: hp }));
        const a = run();
        expect(run().map((r) => r.image.path)).toEqual(a.map((r) => r.image.path)); // two builds, same week, same images
        const paths = a.map((r) => r.image.path);
        expect(new Set(paths).size).toBe(paths.length);                              // no two sections share an image
        const hpPath = [...thisWeekImagesFor(town), ...HOLIDAYS.flatMap((h) => holidayImagesFor(town, h.id))].find((i) => i.id === hp)?.path;
        if (hpPath) expect(paths).not.toContain(hpPath);                              // never the homepage's image
        expect(a.every((r) => r.source === 'rotation')).toBe(true);
      }
    });

    it(`${town}: two builds on different days of the same ISO week agree`, () => {
      const mon = new Date(Date.UTC(2026, 9, 26, 15)); // Mon Oct 26
      const sun = new Date(Date.UTC(2026, 10, 1, 4));  // Sun Nov 1 (still local Oct 31/Nov 1 evening)
      for (const s of sections) {
        expect(getSectionHero(town, s, sun).image.path).toBe(getSectionHero(town, s, mon).image.path);
      }
    });
  }

  it('the real pools are too small for a 60-day no-repeat: report the true gap', () => {
    // 15 images / 9 sections: an image can return after 1 week, not 9. This is the
    // arithmetic the build-time warning (build-checks.ts) prints; the rule cannot
    // be met without ~9 weeks x sections distinct photos per season and town.
    const n = thisWeekImagesFor('brookings_sd').filter((i) => i.seasons.includes('autumn')).length;
    expect(sectionHeroGapWeeks(n, sectionsFor('brookings_sd').length)).toBe(Math.floor(n / 9));
    expect(sectionHeroGapWeeks(n, 9)).toBeLessThan(9);
  });
});

describe('getSectionHero (a pool big enough for the 60-day rule)', () => {
  const S = sectionsFor('brookings_sd').length;
  const big = Array.from({ length: S * 10 + 1 }, (_, i) => img(`brookings_sd-autumn-${String(i).padStart(3, '0')}`));

  it('no section repeats an image within 60 days (9 weeks), no repeats across sections within a week, homepage excluded', () => {
    const weeks = weekDates(10); // 10 consecutive weeks, all drawn from the one synthetic pool
    const hpPerWeek = weeks.map((_, i) => big[(i * 13) % big.length].id);
    const bySection = new Map<HeroSection, { week: number; id: string }[]>();
    weeks.forEach((date, w) => {
      const ids = sectionsFor('brookings_sd').map((s) => {
        const r = getSectionHero('brookings_sd', s, date, { seasonPool: big, holidayPool: [], homepageImageId: hpPerWeek[w] });
        const list = bySection.get(s) ?? []; list.push({ week: w, id: (r.image as PoolImage).id }); bySection.set(s, list);
        return (r.image as PoolImage).id;
      });
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(hpPerWeek[w]);
    });
    for (const list of bySection.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].id === list[j].id) expect(list[j].week - list[i].week).toBeGreaterThan(8); // 60 days = 8.6 weeks, so a repeat must be 9+ weeks apart
        }
      }
    }
  });

  it('slot indexes are unique within a town', () => {
    const idx = sectionsFor('moreno_valley_ca').map((s) => slotIndex('moreno_valley_ca', s));
    expect(new Set(idx).size).toBe(idx.length);
  });
});

describe('reserve behavior', () => {
  const date = new Date(Date.UTC(2026, 9, 21, 12));
  it('uses the reserve only when the seasonal/holiday pool is empty', () => {
    const reserve = [{ path: '/r.png', alt: 'r', width: 1, height: 1 }];
    const r = getSectionHero('brookings_sd', 'events', date, { seasonPool: [], holidayPool: [], reserve });
    expect(r.source).toBe('reserve');
    expect(r.image.path).toBe('/r.png');
    const live = getSectionHero('brookings_sd', 'events', date, { seasonPool: [img('a'), img('b')], holidayPool: [], reserve });
    expect(live.source).toBe('rotation');
  });
  it('fails the build when there is neither a pool nor a reserve', () => {
    expect(() => getSectionHero('brookings_sd', 'events', date, { seasonPool: [], holidayPool: [], reserve: [] })).toThrow(/no hero/);
  });
  it('spring (no curated season pool yet) falls to the section reserve instead of a wrong-season image', () => {
    const spring = new Date(Date.UTC(2027, 3, 14, 12));
    const r = getSectionHero('brookings_sd', 'events', spring);
    expect(r.source).toBe('reserve');
    expect(r.image.path).toMatch(/categories\/brookings_sd-events-/);
    expect(r.image.path).not.toMatch(/events-(1|2)\.png$/); // the parade photos with readable shop signs are gone
  });
});
