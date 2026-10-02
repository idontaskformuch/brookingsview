import { describe, expect, it } from 'vitest';
import { relativeTime, dayTimeKicker } from './time';

const LA = 'America/Los_Angeles';
const CHI = 'America/Chicago';

describe('relativeTime -- past', () => {
  it('says "just now" for under 60 minutes ago', () => {
    const now = new Date('2026-08-25T18:30:00Z');
    expect(relativeTime('2026-08-25T18:00:01Z', now, CHI)).toBe('just now');
  });

  it('says "just now" at exactly 59 minutes ago', () => {
    const now = new Date('2026-08-25T18:59:00Z');
    expect(relativeTime('2026-08-25T18:00:00Z', now, CHI)).toBe('just now');
  });

  it('says "this morning" for an earlier local time before noon, same day', () => {
    // 2026-08-25 08:00 America/Chicago = 13:00 UTC
    const now = new Date('2026-08-25T16:00:00Z');
    expect(relativeTime('2026-08-25T13:00:00Z', now, CHI)).toBe('this morning');
  });

  it('says "this afternoon" for local 12:00-17:00, same day', () => {
    // 2026-08-25 14:00 America/Chicago = 19:00 UTC
    const now = new Date('2026-08-25T21:00:00Z');
    expect(relativeTime('2026-08-25T19:00:00Z', now, CHI)).toBe('this afternoon');
  });

  it('says "this evening" for local after 17:00, same day', () => {
    // 2026-08-25 20:00 America/Chicago = 01:00 UTC next day
    const now = new Date('2026-08-26T03:00:00Z');
    expect(relativeTime('2026-08-26T01:00:00Z', now, CHI)).toBe('this evening');
  });

  it('says "yesterday" for the previous local calendar day', () => {
    const now = new Date('2026-08-25T16:00:00Z'); // 2026-08-25 11:00 Chicago
    expect(relativeTime('2026-08-24T16:00:00Z', now, CHI)).toBe('yesterday');
  });

  it('says the weekday name for 2-6 days ago', () => {
    const now = new Date('2026-08-25T16:00:00Z'); // Tuesday
    expect(relativeTime('2026-08-21T16:00:00Z', now, CHI)).toBe('Friday'); // 4 days ago
  });

  it('says the month/day for 7+ days ago, same year', () => {
    const now = new Date('2026-08-25T16:00:00Z');
    expect(relativeTime('2026-08-10T16:00:00Z', now, CHI)).toBe('August 10');
  });

  it('includes the year when the date is a different year than now', () => {
    const now = new Date('2026-08-25T16:00:00Z');
    expect(relativeTime('2025-08-10T16:00:00Z', now, CHI)).toBe('August 10, 2025');
  });

  it('uses the TOWN zoned calendar day, not the UTC calendar day, to decide "this afternoon"', () => {
    // date = 2026-08-25 15:00 Chicago (2026-08-25T20:00:00Z); now = 2026-08-25
    // 21:00 Chicago (2026-08-26T02:00:00Z) -- different UTC calendar dates
    // (25th vs 26th) but the SAME Chicago calendar date, and over an hour
    // apart so the <60min "just now" rule doesn't short-circuit the check.
    const now = new Date('2026-08-26T02:00:00Z');
    expect(relativeTime('2026-08-25T20:00:00Z', now, CHI)).toBe('this afternoon');
  });

  it('23:59 vs 00:01 local: crossing local midnight resolves as "yesterday"', () => {
    // now = 2026-08-25 23:59 Chicago (2026-08-26T04:59:00Z)
    // date = 2026-08-24 00:01 Chicago (2026-08-24T05:01:00Z) -- almost 48h
    // apart, both instants pinned right at the local midnight boundary.
    const date = new Date('2026-08-24T05:01:00Z');
    const now = new Date('2026-08-26T04:59:00Z');
    expect(relativeTime(date, now, CHI)).toBe('yesterday');
  });
});

describe('relativeTime -- future', () => {
  it('says "today at <time>" for later today, local time', () => {
    // 2026-08-25 18:00 Chicago = 23:00 UTC
    const now = new Date('2026-08-25T20:00:00Z');
    expect(relativeTime('2026-08-25T23:00:00Z', now, CHI)).toBe('today at 6pm');
  });

  it('formats a half-hour time with minutes', () => {
    const now = new Date('2026-08-25T20:00:00Z');
    expect(relativeTime('2026-08-25T23:30:00Z', now, CHI)).toBe('today at 6:30pm');
  });

  it('says "tomorrow at <time>"', () => {
    const now = new Date('2026-08-25T16:00:00Z'); // 2026-08-25 11:00 Chicago
    // 2026-08-26 18:00 Chicago = 23:00 UTC
    expect(relativeTime('2026-08-26T23:00:00Z', now, CHI)).toBe('tomorrow at 6pm');
  });

  it('says "<weekday> at <time>" for 2-6 days out', () => {
    const now = new Date('2026-08-25T16:00:00Z'); // Tuesday
    // 2026-08-29 is Saturday, 18:00 Chicago = 23:00 UTC that day
    expect(relativeTime('2026-08-29T23:00:00Z', now, CHI)).toBe('Saturday at 6pm');
  });

  it('says "next <weekday>" for 7-13 days out', () => {
    const now = new Date('2026-08-25T16:00:00Z'); // Tuesday
    // 9 days out
    expect(relativeTime('2026-09-03T16:00:00Z', now, CHI)).toBe('next Thursday');
  });

  it('says the month/day for 14+ days out', () => {
    const now = new Date('2026-08-25T16:00:00Z');
    expect(relativeTime('2026-09-15T16:00:00Z', now, CHI)).toBe('September 15');
  });

  it('includes the year for a future date in a different year', () => {
    const now = new Date('2026-12-25T16:00:00Z');
    expect(relativeTime('2027-01-15T16:00:00Z', now, CHI)).toBe('January 15, 2027');
  });
});

describe('relativeTime -- DST transitions', () => {
  it('America/Los_Angeles spring-forward (2026-03-08): day diff stays 1, not skewed by the missing hour', () => {
    // 2026-03-07 20:00 PST = 2026-03-08 04:00 UTC (independently verified via Intl)
    const now = new Date('2026-03-08T04:00:00Z');
    // 2026-03-08 21:00 PDT, after spring-forward = 2026-03-09 04:00 UTC
    expect(relativeTime('2026-03-09T04:00:00Z', now, LA)).toBe('tomorrow at 9pm');
  });

  it('America/Chicago fall-back (2026-11-01): day diff stays 1, not skewed by the repeated hour', () => {
    // 2026-10-31 20:00 CDT = 2026-11-01 01:00 UTC
    const now = new Date('2026-11-01T01:00:00Z');
    // 2026-11-01 20:00 CST (after fall back) = 2026-11-02 02:00 UTC
    expect(relativeTime('2026-11-02T02:00:00Z', now, CHI)).toBe('tomorrow at 8pm');
  });

  it('Los Angeles and Chicago disagree on "today" vs "tomorrow" for the same pair of instants', () => {
    // now = 2026-08-26 01:30 Chicago / 2026-08-25 23:30 Los Angeles (already
    // past midnight in Chicago, not yet in LA); date (the event) =
    // 2026-08-26 15:00 Chicago / 13:00 Los Angeles, a few hours later --
    // independently verified via Intl before asserting.
    const now = new Date('2026-08-26T06:30:00Z');
    const date = new Date('2026-08-26T20:00:00Z');
    expect(relativeTime(date, now, CHI)).toBe('today at 3pm');
    expect(relativeTime(date, now, LA)).toBe('tomorrow at 1pm');
  });
});

describe('relativeTime -- year rollover', () => {
  it('treats Dec 31 -> Jan 1 as "tomorrow", not a large day count', () => {
    // 2026-12-31T16:00:00Z = 10:00 CST; 2027-01-01T23:00:00Z = 17:00 CST
    // (independently verified via Intl -- December/January is CST, UTC-6).
    const now = new Date('2026-12-31T16:00:00Z');
    expect(relativeTime('2027-01-01T23:00:00Z', now, CHI)).toBe('tomorrow at 5pm');
  });

  it('treats Jan 1 relative to a "now" of the previous Dec 31 as year-rollover, not same year', () => {
    const now = new Date('2026-12-31T16:00:00Z');
    expect(relativeTime('2025-01-01T16:00:00Z', now, CHI)).toBe('January 1, 2025');
  });
});

// 2026-10-02, item C2: a real in-progress window, not just "< 60 minutes
// since start" (which the pre-existing "just now" tests above already
// cover and are unaffected by -- endsAt is optional and additive).
describe('relativeTime -- endsAt (real in-progress window)', () => {
  it('says "now" when the current time is between start and end', () => {
    const start = new Date('2026-08-25T18:00:00Z');
    const end = new Date('2026-08-25T20:00:00Z');
    const now = new Date('2026-08-25T19:30:00Z'); // 90 min after start, still before end
    expect(relativeTime(start, now, CHI, end)).toBe('now');
  });

  it('says "now" at the exact start instant', () => {
    const start = new Date('2026-08-25T18:00:00Z');
    const end = new Date('2026-08-25T20:00:00Z');
    expect(relativeTime(start, start, CHI, end)).toBe('now');
  });

  it('falls through to normal past text once the end instant has passed', () => {
    const start = new Date('2026-08-25T18:00:00Z');
    const end = new Date('2026-08-25T20:00:00Z');
    const now = new Date('2026-08-25T20:00:01Z'); // 1 second after end
    expect(relativeTime(start, now, CHI, end)).toBe('this afternoon');
  });

  it('a future event (start still ahead of now) is unaffected by endsAt', () => {
    const start = new Date('2026-08-25T18:00:00Z');
    const end = new Date('2026-08-25T20:00:00Z');
    const now = new Date('2026-08-25T10:00:00Z');
    expect(relativeTime(start, now, CHI, end)).toBe(relativeTime(start, now, CHI));
  });

  it('without endsAt, behavior is completely unchanged (every pre-existing call site)', () => {
    const now = new Date('2026-08-25T18:30:00Z');
    expect(relativeTime('2026-08-25T18:00:01Z', now, CHI)).toBe('just now');
    expect(relativeTime('2026-08-25T18:00:01Z', now, CHI, null)).toBe('just now');
    expect(relativeTime('2026-08-25T18:00:01Z', now, CHI, undefined)).toBe('just now');
  });
});

describe('dayTimeKicker', () => {
  it('formats as "{short weekday} · {h:mm AM/PM}"', () => {
    // 2026-08-27T19:30:00Z = 14:30 CDT (UTC-5 in August) = Thursday
    expect(dayTimeKicker('2026-08-27T19:30:00Z', CHI)).toBe('Thu · 2:30 PM');
  });

  it('omits the :00 minutes for an on-the-hour time', () => {
    // 2026-08-27T19:00:00Z = 14:00 CDT = Thursday
    expect(dayTimeKicker('2026-08-27T19:00:00Z', CHI)).toBe('Thu · 2 PM');
  });

  it('uses 12 for both noon and midnight, never 0', () => {
    // 2026-08-27T17:00:00Z = 12:00 CDT noon
    expect(dayTimeKicker('2026-08-27T17:00:00Z', CHI)).toBe('Thu · 12 PM');
    // 2026-08-28T05:00:00Z = 00:00 CDT midnight -> Friday local
    expect(dayTimeKicker('2026-08-28T05:00:00Z', CHI)).toBe('Fri · 12 AM');
  });

  it('is timezone-aware, not UTC', () => {
    // 2026-08-27T19:30:00Z = 12:30 PDT (Pacific) same instant, different wall time
    expect(dayTimeKicker('2026-08-27T19:30:00Z', LA)).toBe('Thu · 12:30 PM');
  });
});
