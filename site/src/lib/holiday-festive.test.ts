import { describe, expect, it } from 'vitest';
import { holidayPageFor } from '../config/holiday-pages/registry';
import { HOLIDAY_THEMES } from '../config/holiday-themes';
import { closureGrid, seasonClosureGrid } from './holiday-view';
import { adventStrip, clock, dayBlocks, digestLine, featuredOf, holidayMatrix, keyDays, seasonRuns, stripRange, weekGroups } from './holiday-festive';
import type { ConfirmedEvent, HolidayPageData } from './holiday-page';

// Real data: the towns' own Christmas pages (config/holiday-pages/christmas*.ts), as the build reads them.
const page = (town: string) => holidayPageFor('christmas', town)!.page;
const grid = (p: HolidayPageData) => (p.season ? seasonClosureGrid(p) : closureGrid(p));
const confirmed = (p: HolidayPageData) => p.events.filter((e): e is ConfirmedEvent => e.status === 'confirmed');
const TODAY = '2026-11-26';

describe('the strip and the key days', () => {
  it('runs 20 Dec to 2 Jan; the matrix keys are 24, 25, 26, 31 Dec and 1 Jan', () => {
    expect(stripRange(2026)).toEqual({ first: '2026-12-20', last: '2027-01-02' });
    expect(keyDays(2026)).toEqual(['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31', '2027-01-01']);
  });

  it('Glasgow: 14 tiles; 25 Dec has a closure and no trains (ScotRail), and links to its day', () => {
    const p = page('glasgow');
    const g = grid(p);
    const blocks = dayBlocks(p, confirmed(p), g, TODAY);
    const strip = adventStrip(p, confirmed(p), g, new Set(blocks.map((b) => b.iso)));
    expect(strip).toHaveLength(14);
    const xmas = strip.find((d) => d.iso === '2026-12-25')!;
    expect([xmas.closed, xmas.noTransit, xmas.href]).toEqual([true, true, '#dec-25']);
    expect(strip[0].month).toBe('Dec');
    expect(strip.find((d) => d.iso === '2027-01-01')!.month).toBe('Jan');
  });
});

describe('the matrix', () => {
  it('Broomfield: the FISH food bank closed 24, 25 Dec and 1 Jan, Normal on the other key days', () => {
    const p = page('broomfield_co');
    const m = holidayMatrix(p, grid(p))!;
    expect(m.days.map((d) => d.iso)).toEqual(keyDays(2026));
    const fish = m.rows.find((r) => /FISH/.test(r.name))!;
    expect(fish.cells.map((c) => c.kind)).toEqual(['closed', 'closed', 'normal', 'normal', 'closed']);
  });

  it('Glasgow: ScotRail says "No trains" on 25 Dec (its own word, marked); a day a place changes outside the keys is a column too', () => {
    const p = page('glasgow');
    const m = holidayMatrix(p, grid(p))!;
    const i = m.days.findIndex((d) => d.iso === '2026-12-25');
    const rail = m.rows.find((r) => r.name === 'ScotRail')!;
    expect(rail.cells[i]).toEqual({ kind: 'closed', text: 'No trains' });
    for (const k of keyDays(2026)) expect(m.days.map((d) => d.iso)).toContain(k);
  });

  it('no grid, no matrix', () => {
    expect(holidayMatrix(page('broomfield_co'), null)).toBeNull();
  });
});

describe('day blocks', () => {
  it('digest line: the count, then what is shut, at most three then "+N more closed"', () => {
    expect(digestLine(3, ['St Enoch closed', 'No trains'])).toBe('3 events · St Enoch closed · No trains');
    expect(digestLine(0, ['Broomfield FISH food bank closed'])).toBe('Broomfield FISH food bank closed');
    expect(digestLine(1, ['a', 'b', 'c', 'd', 'e'])).toBe('1 event · a · b · c · +2 more closed');
  });

  it('Broomfield: Christmas Eve, Christmas Day and New Year\'s Day get a block from the closures alone, with their names', () => {
    const p = page('broomfield_co');
    const blocks = dayBlocks(p, confirmed(p), grid(p), TODAY);
    expect(blocks.map((b) => [b.iso, b.name])).toEqual([
      ['2026-12-24', 'Christmas Eve'], ['2026-12-25', 'Christmas Day'], ['2027-01-01', "New Year's Day"],
    ]);
    expect(blocks[0].digest).toMatch(/FISH food bank closed$/);
  });

  it('Glasgow: the featured event is the one on the fewest days of the season, not the daily panto', () => {
    const p = page('glasgow');
    const all = confirmed(p);
    for (const b of dayBlocks(p, all, grid(p), TODAY)) {
      if (!b.featured) continue;
      const days = (e: ConfirmedEvent) => new Set(all.filter((x) => x.name === e.name && x.venue.name === e.venue.name).map((x) => x.date)).size;
      for (const r of b.rows) expect(days(b.featured)).toBeLessThanOrEqual(days(r));
    }
    expect(featuredOf([], all)).toBeNull();
  });

  it('runs over several days are the season carousel, not a day\'s events; other weeks are grouped by week', () => {
    const p = page('broomfield_co');
    expect(seasonRuns(confirmed(p), TODAY).map((e) => e.name)).toEqual(['Mile High Drone Shows', 'Denver Christkindlmarket']);
    const w = weekGroups(p, confirmed(p), TODAY);
    expect(w[0].heading).toBe('Week of Nov 30');
    expect(w[0].rows.map((r) => r.e.name)).toContain('Holiday Tree Lighting Ceremony');
  });
});

describe('times', () => {
  it('12:00 is "Noon", never 12 PM', () => {
    expect(clock('12:00', 'en-GB')).toBe('Noon');
    expect(clock('12:00', 'en-US')).toBe('Noon');
    expect(clock('19:30', 'en-GB')).toBe('7:30pm');
  });
});

describe('holiday themes (config/holiday-themes.ts)', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  it('text on the date tile is AA in both schemes', () => {
    for (const t of Object.values(HOLIDAY_THEMES)) {
      expect(ratio(t!.light.ink, t!.light.on)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t!.dark.ink, t!.dark.on)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
