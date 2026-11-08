import { describe, expect, it } from 'vitest';
import { runLabel, showDate, showTimeGb } from './whats-on-dates';

const TZ = 'America/Chicago';
const now = new Date('2026-10-23T18:00:00Z');

describe('What\'s On dates show the year when it is not this year', () => {
  it('no year in the current year, year for another one', () => {
    expect(showDate('2026-11-17T01:00:00Z', TZ, now)).toBe('Mon, Nov 16');
    expect(showDate('2027-07-17T19:00:00Z', TZ, now)).toBe('Sat, Jul 17, 2027');
    expect(showDate('2027-07-17T19:00:00Z', TZ, now, false)).toBe('Jul 17, 2027');
  });
  it('uses the town zone for the year boundary (Jan 1 00:30Z is still Dec 31 in Chicago)', () => {
    expect(showDate('2027-01-01T00:30:00Z', TZ, now)).toBe('Thu, Dec 31');
  });
});

describe('runLabel', () => {
  it('a run over several days', () => {
    expect(runLabel(6, '2026-11-14T20:00:00Z', '2026-11-16T02:00:00Z', TZ, now)).toBe('6 dates, Sat, Nov 14 – Sun, Nov 15');
  });
  it('several shows on the same day: no "Oct 27 – Oct 27"', () => {
    expect(runLabel(2, '2026-10-27T19:00:00Z', '2026-10-28T00:00:00Z', TZ, now)).toBe('2 shows on Tue, Oct 27');
  });
  it('a single date has no run label; a run into next year shows the year', () => {
    expect(runLabel(1, '2026-10-27T19:00:00Z', '2026-10-27T19:00:00Z', TZ, now)).toBeNull();
    expect(runLabel(3, '2026-12-30T20:00:00Z', '2027-01-02T20:00:00Z', TZ, now)).toBe('3 dates, Wed, Dec 30 – Sat, Jan 2, 2027');
  });
});

describe('showTimeGb (owner 2026-10-28: a clock time on every Glasgow show row)', () => {
  it('UK clock in the venue zone, nothing for a date-only listing', () => {
    expect(showTimeGb('2026-10-28T19:00:00Z', 'Europe/London')).toBe('7pm');
    expect(showTimeGb('2026-12-06T19:30:00Z', 'Europe/London')).toBe('7:30pm');
    expect(showTimeGb('2026-07-01T23:00:00Z', 'Europe/London')).toBe('');
  });
});

describe('gb order (owner 2026-11-08): day first, no commas', () => {
  const gbNow = new Date('2026-11-08T12:00:00Z');
  it('weekday + day + month; year only in another year', () => {
    expect(showDate('2026-11-16T19:00:00Z', 'Europe/London', gbNow, true, 'gb')).toBe('Mon 16 Nov');
    expect(showDate('2027-07-17T19:00:00Z', 'Europe/London', gbNow, true, 'gb')).toBe('Sat 17 Jul 2027');
    expect(showDate('2027-07-17T19:00:00Z', 'Europe/London', gbNow, false, 'gb')).toBe('17 Jul 2027');
  });
  it('us is unchanged', () => {
    expect(showDate('2026-11-17T01:00:00Z', TZ, now, true, 'us')).toBe('Mon, Nov 16');
  });
  it('a run label follows the same order', () => {
    expect(runLabel(3, '2026-11-14T19:00:00Z', '2026-11-15T19:00:00Z', 'Europe/London', gbNow, 'gb')).toBe('3 dates, Sat 14 Nov – Sun 15 Nov');
  });
});
