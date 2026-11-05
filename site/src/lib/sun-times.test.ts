import { describe, expect, it } from 'vitest';
import { sunTimes } from './sun-times';

const minutesFrom = (d: Date, iso: string) => Math.abs(d.getTime() - Date.parse(iso)) / 60_000;

describe('sunTimes', () => {
  // Reference values from timeanddate.com for the town centres (rounded to the minute there).
  it('London-latitude midsummer: sunrise 03:43 UTC, sunset 20:21 UTC (within 3 minutes)', () => {
    const s = sunTimes(2026, 6, 21, 51.5074, -0.1278)!;
    expect(minutesFrom(s.sunrise, '2026-06-21T03:43:00Z')).toBeLessThan(3);
    expect(minutesFrom(s.sunset, '2026-06-21T20:21:00Z')).toBeLessThan(3);
  });
  it('Denver midwinter: sunrise 07:17 MST (14:17 UTC), sunset 16:38 MST (23:38 UTC)', () => {
    const s = sunTimes(2026, 12, 21, 39.7392, -104.9903)!;
    expect(minutesFrom(s.sunrise, '2026-12-21T14:17:00Z')).toBeLessThan(3);
    expect(minutesFrom(s.sunset, '2026-12-21T23:38:00Z')).toBeLessThan(3);
  });
  it('Glasgow in November: a short day, sunrise after 07:00 and sunset before 16:45 UTC', () => {
    const s = sunTimes(2026, 11, 5, 55.8642, -4.2518)!;
    expect(s.sunrise.getUTCHours() * 60 + s.sunrise.getUTCMinutes()).toBeGreaterThan(7 * 60);
    expect(s.sunset.getUTCHours() * 60 + s.sunset.getUTCMinutes()).toBeLessThan(16 * 60 + 45);
    expect(s.sunset.getTime()).toBeGreaterThan(s.sunrise.getTime());
  });
  it('the Moreno Valley sunset falls after midnight UTC (local evening) and still comes after sunrise', () => {
    const s = sunTimes(2026, 11, 5, 33.9425, -117.2297)!;
    expect(s.sunset.getTime()).toBeGreaterThan(s.sunrise.getTime());
    expect(s.sunset.getTime() - s.sunrise.getTime()).toBeGreaterThan(9.5 * 3_600_000);
    expect(s.sunset.getTime() - s.sunrise.getTime()).toBeLessThan(11.5 * 3_600_000);
  });
  it('is null where the Sun does not rise or set (polar day and night)', () => {
    expect(sunTimes(2026, 6, 21, 80, 10)).toBeNull();
    expect(sunTimes(2026, 12, 21, 80, 10)).toBeNull();
  });
});
