import { describe, expect, it } from 'vitest';
import { computeOpenStatus } from './facility-hours';
import type { StructuredHours } from './db';

const TZ = 'America/Chicago';

const MON_THU_9_5: StructuredHours = {
  monday: ['09:00', '17:00'], tuesday: ['09:00', '17:00'], wednesday: ['09:00', '17:00'],
  thursday: ['09:00', '17:00'], friday: ['09:00', '12:00'], saturday: null, sunday: null,
};

// 2026-09-07 is a real Monday.
function chicagoInstant(hour: number, minute: number, day = 7): Date {
  // Chicago is UTC-5 in September (CDT) -- construct the UTC instant that
  // corresponds to the given Chicago local time directly, rather than
  // relying on the test runner's own local timezone.
  return new Date(Date.UTC(2026, 8, day, hour + 5, minute));
}

describe('computeOpenStatus', () => {
  it('unknown when there is no structured data at all', () => {
    expect(computeOpenStatus(null, chicagoInstant(10, 0), TZ)).toEqual({ known: false });
  });

  it('open during the window, reports the real close time', () => {
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(10, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: true, closesAt: '5:00 PM' });
  });

  it('open exactly at the opening minute (inclusive boundary)', () => {
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(9, 0), TZ);
    expect(status.known && status.isOpen).toBe(true);
  });

  it('closed exactly at the closing minute (exclusive boundary)', () => {
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(17, 0), TZ);
    expect(status.known && !status.isOpen).toBe(true);
  });

  it('closed before opening, reports opening later today', () => {
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(7, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'today' });
  });

  it('closed after closing, reports opening tomorrow', () => {
    // Monday 6pm -- closed for the day, opens Tuesday 9am.
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(18, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'tomorrow' });
  });

  it('closed on a weekend day with no window, skips forward past both closed days', () => {
    // Friday (day 11) closes at noon -- Friday 3pm should skip Sat/Sun (both
    // null) and land on Monday.
    const status = computeOpenStatus(MON_THU_9_5, chicagoInstant(15, 0, 11), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'Monday' });
  });

  it('a facility with no open day at all reports a real, honest state, not a crash', () => {
    const neverOpen: StructuredHours = {
      monday: null, tuesday: null, wednesday: null, thursday: null,
      friday: null, saturday: null, sunday: null,
    };
    const status = computeOpenStatus(neverOpen, chicagoInstant(10, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '', opensLabel: 'not open this week' });
  });

  it('a facility open exactly one day a week is still found up to 6 days out', () => {
    const sundayOnly: StructuredHours = {
      monday: null, tuesday: null, wednesday: null, thursday: null,
      friday: null, saturday: null, sunday: ['13:00', '17:00'],
    };
    // Monday 10am -- next opening is Sunday, 6 days away.
    const status = computeOpenStatus(sundayOnly, chicagoInstant(10, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '1:00 PM', opensLabel: 'Sunday' });
  });

  it('formats half-hour and midnight-adjacent times correctly', () => {
    const halfHour: StructuredHours = {
      monday: ['05:00', '18:30'], tuesday: null, wednesday: null, thursday: null,
      friday: null, saturday: null, sunday: null,
    };
    const status = computeOpenStatus(halfHour, chicagoInstant(6, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: true, closesAt: '6:30 PM' });
  });
});
