import { describe, expect, it } from 'vitest';
import { forecastLine, weekendForecastLine } from './weather-format';

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

describe('weekendForecastLine', () => {
  const p = (start: string, temp: number, short: string, is_daytime: boolean) => ({ name: null, start, temp, unit: 'C', short, wind: null, is_daytime });
  const periods = [
    p('2026-10-30T07:00:00Z', 12, 'Light Rain', true), p('2026-10-30T18:00:00Z', 7, 'Cloudy', false),
    p('2026-10-31T07:00:00Z', 11, 'Cloudy', true), p('2026-11-01T07:00:00Z', 9, 'Sunny', true),
  ];
  const days = [20_756, 20_757, 20_758]; // 2026-10-30 .. 11-01
  it('one part per weekend day, Friday to Sunday', () => {
    expect(weekendForecastLine(periods, 'Europe/London', new Date('2026-10-29T10:00:00Z'), days))
      .toBe('Friday: 12°C light rain. Saturday: 11°C cloudy. Sunday: 9°C sunny.');
  });
  it('on Friday evening the day period is over, so Friday shows the night period', () => {
    expect(weekendForecastLine(periods, 'Europe/London', new Date('2026-10-30T19:30:00Z'), days)).toMatch(/^Friday night: 7°C cloudy\./);
  });
  it('leaves out days the forecast does not reach, and is empty with no data', () => {
    expect(weekendForecastLine(periods.slice(0, 2), 'Europe/London', new Date('2026-10-29T10:00:00Z'), days)).toBe('Friday: 12°C light rain.');
    expect(weekendForecastLine([], 'Europe/London', new Date(), days)).toBe('');
  });
});
