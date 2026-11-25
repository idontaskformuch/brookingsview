import { describe, expect, it } from 'vitest';
import { sunriseHHMM } from './sun';
import { computePlaceOpenStatus } from './place-hours';
import { summarizeHours } from './facility-lede';
import { formatClock } from './facility-hours';
import { rowsFromWeek } from './hours-spec';

// Town centres from lib/site-config.ts (townCenter).
const BROOKINGS = { lat: 44.3114, lon: -96.7984 };
const BROOMFIELD = { lat: 39.9205, lon: -105.0866 };

describe('sunriseHHMM: the sunrise equation, per day, in the town\'s clock', () => {
  it('Brookings, late November and midsummer', () => {
    expect(sunriseHHMM('2026-11-25', BROOKINGS.lat, BROOKINGS.lon, 'America/Chicago')).toBe('07:36');
    expect(sunriseHHMM('2026-06-21', BROOKINGS.lat, BROOKINGS.lon, 'America/Chicago')).toBe('05:43');
  });
  it('Broomfield at the winter solstice', () => {
    expect(sunriseHHMM('2026-12-21', BROOMFIELD.lat, BROOMFIELD.lon, 'America/Denver')).toBe('07:18');
  });
  it('the clock change moves it an hour, the sun only a minute (DST starts 2026-03-08)', () => {
    expect(sunriseHHMM('2026-03-07', BROOKINGS.lat, BROOKINGS.lon, 'America/Chicago')).toBe('06:54');
    expect(sunriseHHMM('2026-03-08', BROOKINGS.lat, BROOKINGS.lon, 'America/Chicago')).toBe('07:52');
  });
});

// Pioneer Park, Brookings facility catalog: "Sunrise to 11:00p.m." -> every day ["sunrise", "23:00"].
const w: [string, string] = ['sunrise', '23:00'];
const PIONEER = rowsFromWeek({ monday: w, tuesday: w, wednesday: w, thursday: w, friday: w, saturday: w, sunday: w });

describe('a park open from sunrise', () => {
  it('before sunrise it is closed and opens at today\'s sunrise', () => {
    // 2026-11-25 07:00 Central = 13:00Z; sunrise 07:36
    expect(computePlaceOpenStatus(PIONEER, [], new Date('2026-11-25T13:00:00Z'), 'America/Chicago', false, BROOKINGS))
      .toEqual({ known: true, isOpen: false, opensAt: '7:36 AM', opensLabel: 'today' });
  });
  it('after sunrise it is open until 11 pm', () => {
    expect(computePlaceOpenStatus(PIONEER, [], new Date('2026-11-25T14:00:00Z'), 'America/Chicago', false, BROOKINGS))
      .toEqual({ known: true, isOpen: true, closesAt: '11:00 PM' });
  });
  it('without the town\'s coordinates nothing is claimed', () => {
    expect(computePlaceOpenStatus(PIONEER, [], new Date('2026-11-25T14:00:00Z'), 'America/Chicago'))
      .toEqual({ known: true, isOpen: false, opensAt: null, opensLabel: null });
  });
  it('the week line and the table say "sunrise"', () => {
    expect(summarizeHours(PIONEER)).toBe('Mon–Sun sunrise–11pm');
    expect(formatClock('sunrise')).toBe('Sunrise');
  });
});
