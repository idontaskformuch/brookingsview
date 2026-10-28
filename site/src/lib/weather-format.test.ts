import { describe, expect, it } from 'vitest';
import { forecastLine } from './weather-format';

describe('forecastLine (/today forecast row)', () => {
  const tz = 'Europe/London';
  const now = new Date('2026-10-28T12:00:00Z');
  const p = (start: string, day: boolean, temp: number | null, short: string) => ({ start, is_daytime: day, temp, unit: 'C', short, wind: null });
  it('two upcoming periods, labelled for the town day', () => {
    const periods = [p('2026-10-28T08:00:00Z', true, 14, 'Cloudy'), p('2026-10-28T18:00:00Z', false, 8, 'Clear'), p('2026-10-29T08:00:00Z', true, 12, 'Rain')];
    expect(forecastLine(periods, tz, now)).toBe('Today: 14°C cloudy. Tonight: 8°C clear.');
  });
  it('nothing when there is no usable period', () => {
    expect(forecastLine([], tz, now)).toBe('');
    expect(forecastLine([p('2026-10-28T08:00:00Z', true, null, 'Cloudy')], tz, now)).toBe('');
  });
});
