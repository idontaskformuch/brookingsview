import { describe, expect, it } from 'vitest';
import { getSectionHero, sectionsFor, slotIndex, type PoolImage } from './section-hero';
import { thisWeekImagesFor } from '../config/this-week-images';
import { HOLIDAYS, holidayImagesFor } from '../config/holidays';
import { resolveActiveHoliday } from './holidays';
import { weekInfoForInstant } from './this-week';
import { seasonForMonth } from './this-week-images';

const TOWNS = ['brookings_sd', 'moreno_valley_ca', 'broomfield_co'] as const;
const TZ: Record<string, string> = { brookings_sd: 'America/Chicago', moreno_valley_ca: 'America/Los_Angeles', broomfield_co: 'America/Denver' };

/** Noon UTC on the Wednesday of each of `weeks` consecutive weeks from 2026-10-21. */
function weekDates(weeks: number): Date[] {
  return Array.from({ length: weeks }, (_, i) => new Date(Date.UTC(2026, 9, 21 + 7 * i, 12)));
}

function img(id: string): PoolImage {
  return { id, path: `/x/${id}.jpg`, alt: id, width: 1200, height: 800 };
}

/** A stand-in for the homepage's own pick for that week. */
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
});

describe('hero changes at month, season and holiday boundaries (not weekly)', () => {
  const town = 'brookings_sd';
  const pathFor = (d: Date) => getSectionHero(town, 'events', d).image.path;

  it('stays the same for every week inside one plain month', () => {
    // Mon Nov 2 .. Mon Nov 23 2026: November, no holiday window yet (Thanksgiving window starts later)
    const weeks = [2, 9, 16].map((day) => new Date(Date.UTC(2026, 10, day, 18)));
    const picks = weeks.map((d) => {
      const w = weekInfoForInstant(d, TZ[town]);
      return { holiday: resolveActiveHoliday(HOLIDAYS, w.monday, w.sunday), path: pathFor(d) };
    });
    const plain = picks.filter((p) => !p.holiday);
    expect(plain.length).toBeGreaterThanOrEqual(2);
    expect(new Set(plain.map((p) => p.path)).size).toBe(1);
  });

  it('changes when the month changes (holiday windows aside)', () => {
    const all = (d: Date) => sectionsFor(town).map((s) => getSectionHero(town, s, d).image.path);
    const plain = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 7, 5 + 7 * i, 18))).filter((d) => {
      const w = weekInfoForInstant(d, TZ[town]);
      return !resolveActiveHoliday(HOLIDAYS, w.monday, w.sunday) && thisWeekImagesFor(town).some((i) => i.seasons.includes(seasonForMonth(w.monday.m)));
    });
    const monthOf = (d: Date) => weekInfoForInstant(d, TZ[town]).monday.m;
    let checked = 0;
    for (let i = 1; i < plain.length; i++) {
      const prev = plain[i - 1], cur = plain[i];
      const same = monthOf(prev) === monthOf(cur);
      const diff = all(prev).filter((p, k) => p !== all(cur)[k]).length;
      if (same) expect(diff).toBe(0);                       // same month: nothing changes
      else if (cur.getTime() - prev.getTime() <= 8 * 86_400_000) { expect(diff).toBeGreaterThanOrEqual(5); checked++; } // new month: most heroes change
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('images from each season come only from that season (or the active holiday)', () => {
    for (const date of weekDates(14)) {
      const w = weekInfoForInstant(date, TZ[town]);
      const season = seasonForMonth(w.monday.m);
      const holiday = resolveActiveHoliday(HOLIDAYS, w.monday, w.sunday);
      const allowed = new Set([
        ...thisWeekImagesFor(town).filter((i) => i.seasons.includes(season)).map((i) => i.path),
        ...(holiday ? holidayImagesFor(town, holiday.holiday).map((i) => i.path) : []),
      ]);
      for (const s of sectionsFor(town)) expect(allowed.has(getSectionHero(town, s, date).image.path)).toBe(true);
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
    expect(r.image.path).not.toMatch(/events-(1|2)\.png$/);
  });
});
