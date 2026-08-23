import { describe, expect, it } from 'vitest';
import {
  buildSeriesDisplay, commodityLabel, formatDelta, sparklinePath,
} from './farm-report';
import type { AgPriceSeries } from './db';

const monthYear = (value: string) => {
  const [y, m] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

describe('formatDelta', () => {
  it('positive difference is up', () => {
    expect(formatDelta(3.94, 3.82)).toEqual({ direction: 'up', text: '+0.12' });
  });

  it('negative difference is down', () => {
    expect(formatDelta(3.82, 3.94)).toEqual({ direction: 'down', text: '-0.12' });
  });

  it('exact zero is flat, not a fake arrow', () => {
    expect(formatDelta(3.94, 3.94)).toEqual({ direction: 'flat', text: 'no change' });
  });

  it('sub-cent difference still rounds to a real 0.00, stays flat', () => {
    expect(formatDelta(3.9401, 3.94)).toEqual({ direction: 'flat', text: 'no change' });
  });
});

describe('sparklinePath', () => {
  it('null for fewer than 2 points', () => {
    expect(sparklinePath([], 100, 30)).toBeNull();
    expect(sparklinePath([3.94], 100, 30)).toBeNull();
  });

  it('draws a flat middle line for a perfectly flat series (no div-by-zero)', () => {
    const path = sparklinePath([5, 5, 5], 100, 30);
    expect(path).toBe('M0.00,15.00 L50.00,15.00 L100.00,15.00');
  });

  it('rising series ends higher (lower y) than it starts', () => {
    const path = sparklinePath([3.0, 4.0], 100, 30)!;
    const [start, end] = path.slice(1).split(' L').map((p) => p.split(',').map(Number));
    expect(end[1]).toBeLessThan(start[1]);
  });
});

describe('commodityLabel', () => {
  it('known commodity gets a display label', () => {
    expect(commodityLabel('soybeans')).toBe('Soybeans');
  });

  it('unknown commodity falls back to the raw key rather than crashing', () => {
    expect(commodityLabel('quinoa')).toBe('quinoa');
  });
});

describe('buildSeriesDisplay', () => {
  const base: AgPriceSeries = {
    commodity: 'corn',
    unit: '$ / BU',
    latest: { price: 3.94, as_of: '2026-06-01' },
    previous: { price: 3.82, as_of: '2026-05-01' },
    yearAgo: { price: 4.25, as_of: '2025-06-01' },
    history: [
      { price: 3.8, as_of: '2025-06-01' },
      { price: 3.82, as_of: '2026-05-01' },
      { price: 3.94, as_of: '2026-06-01' },
    ],
    rangeMin: 3.8,
    rangeMax: 3.94,
  };

  it('null when there is no latest price at all', () => {
    expect(buildSeriesDisplay({ ...base, latest: null }, monthYear)).toBeNull();
  });

  it('formats price to 2 decimals and includes the month-year label', () => {
    const result = buildSeriesDisplay(base, monthYear)!;
    expect(result.price).toBe('3.94');
    expect(result.asOf).toBe('June 2026');
  });

  it('momDelta is labeled with the REAL previous period, not an assumed "last month"', () => {
    const result = buildSeriesDisplay(base, monthYear)!;
    expect(result.momDelta).toEqual({ direction: 'up', text: '+0.12', comparedTo: 'May 2026' });
  });

  it('momDelta is null when there is no previous point at all', () => {
    const result = buildSeriesDisplay({ ...base, previous: null }, monthYear)!;
    expect(result.momDelta).toBeNull();
  });

  it('yoyDelta uses the real year-ago point when present', () => {
    const result = buildSeriesDisplay(base, monthYear)!;
    expect(result.yoyDelta).toEqual({ direction: 'down', text: '-0.31', comparedTo: 'June 2025' });
  });

  it('yoyDelta is null (not guessed) when no 12-months-back point exists', () => {
    const result = buildSeriesDisplay({ ...base, yearAgo: null }, monthYear)!;
    expect(result.yoyDelta).toBeNull();
  });

  it('rangeText reflects the real stored min/max', () => {
    const result = buildSeriesDisplay(base, monthYear)!;
    expect(result.rangeText).toBe('3.80–3.94');
  });

  it('rangeText is null with fewer than 2 history points (a range needs 2+)', () => {
    const single = { ...base, history: [{ price: 3.94, as_of: '2026-06-01' }] };
    const result = buildSeriesDisplay(single, monthYear)!;
    expect(result.rangeText).toBeNull();
  });
});
