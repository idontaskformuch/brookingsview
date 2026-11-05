import { describe, expect, it } from 'vitest';
import { countryProfile } from '../country-profile';
import { ALL_CONFIGS } from '../site-config';
import { CATEGORY_SETS, planChips, pointPercent, spanPercent, tempStop, windowPercent } from './ui-helpers';

describe('planChips', () => {
  it('keeps chips with >= 3 items, largest first', () => {
    expect(planChips({ Downtown: 5, Eastside: 3, Airport: 2 })).toEqual(['Downtown', 'Eastside']);
  });
  it('returns nothing when fewer than 2 chips qualify', () => {
    expect(planChips({ Downtown: 9, Eastside: 2 })).toEqual([]);
    expect(planChips({})).toEqual([]);
  });
  it('drops labels that contain a number', () => {
    expect(planChips({ 'Route 66': 9, Downtown: 4, Eastside: 4 })).toEqual(['Downtown', 'Eastside']);
  });
  it('ties break alphabetically', () => {
    expect(planChips({ B: 3, A: 3 })).toEqual(['A', 'B']);
  });
});

describe('spanPercent / pointPercent', () => {
  it('places a span on the scale', () => {
    expect(spanPercent(0, 100, 20, 60)).toEqual({ left: 20, width: 40 });
  });
  it('clamps to the scale and keeps a visible minimum width', () => {
    expect(spanPercent(0, 100, -10, 5)).toEqual({ left: 0, width: 5 });
    expect(spanPercent(0, 100, 50, 50)?.width).toBe(2);
  });
  it('is null for missing, inverted or degenerate input', () => {
    expect(spanPercent(0, 100, NaN, 5)).toBeNull();
    expect(spanPercent(0, 100, 60, 20)).toBeNull();
    expect(spanPercent(5, 5, 5, 5)).toBeNull();
    expect(pointPercent(0, 10, 5)).toBe(50);
  });
});

describe('tempStop', () => {
  it('maps boundaries', () => {
    expect([10, 20, 39, 40, 59, 60, 77, 78, 91, 92, 110].map((t) => tempStop(t))).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe('windowPercent', () => {
  it('maps minutes inside the window and rejects outside', () => {
    expect(windowPercent(360, 1440, 900)).toBeCloseTo(50);
    expect(windowPercent(360, 1440, 300)).toBeNull();
    expect(windowPercent(10, 10, 10)).toBeNull();
  });
});

describe('icons', () => {
  it('has an icon for every category', async () => {
    const { ICONS } = await import('./icons');
    const { CATEGORIES } = await import('./ui-helpers');
    for (const c of CATEGORIES) expect(ICONS, c).toHaveProperty(c);
  });
});

describe('tempStop follows the city unit', () => {
  const glasgow = ALL_CONFIGS.find((c) => c.townId === 'glasgow')!;
  const brookings = ALL_CONFIGS.find((c) => c.townId === 'brookings_sd')!;
  it('Glasgow is Celsius, Brookings is Fahrenheit', () => {
    expect(countryProfile(glasgow.country).temperatureUnit).toBe('C');
    expect(countryProfile(brookings.country).temperatureUnit).toBe('F');
  });
  it('the same weather gets the same stop in either unit', () => {
    const unit = countryProfile(glasgow.country).temperatureUnit as 'C';
    for (const f of [5, 19, 20, 39, 40, 59, 60, 77, 78, 91, 92, 105]) {
      expect(tempStop(((f - 32) * 5) / 9, unit), `${f}F`).toBe(tempStop(f, 'F'));
    }
  });
  it('10 degrees C is cool (stop 3), not freezing as it would read in F', () => {
    expect(tempStop(10, 'C')).toBe(3);
    expect(tempStop(10, 'F')).toBe(1);
  });
});

describe('category sets', () => {
  it('Tonight uses nightlife, not civic; meetings and city hall keep civic', () => {
    expect(CATEGORY_SETS.tonight).toContain('nightlife');
    expect(CATEGORY_SETS.tonight).not.toContain('civic');
    expect(CATEGORY_SETS.meetings).toContain('civic');
    expect(CATEGORY_SETS.cityHall).toContain('civic');
  });
});
