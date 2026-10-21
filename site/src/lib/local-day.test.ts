import { describe, expect, it } from 'vitest';
import { bucketOf, countToday, countTonight, eventEndsAt, hasEnded, localDayNumber, relativeDayLabel } from './local-day';

const CHI = 'America/Chicago';
const LA = 'America/Los_Angeles';
const DEN = 'America/Denver';
const at = (s: string) => new Date(s);

describe('bucketOf', () => {
  const ev = (start: string, end?: string) => ({ start, end });
  const now = at('2026-10-20T19:25:00Z'); // 2:25 PM CDT Tue Oct 20

  it('puts a 7 PM CDT event tonight, a 3 PM one in none, tomorrow 10 AM tomorrow', () => {
    expect(bucketOf(ev('2026-10-21T00:00:00Z', '2026-10-21T02:00:00Z'), now, CHI)).toBe('tonight'); // 7 PM CDT
    expect(bucketOf(ev('2026-10-20T20:00:00Z'), now, CHI)).toBeNull();                              // 3 PM CDT, before 17:00
    expect(bucketOf(ev('2026-10-21T15:00:00Z'), now, CHI)).toBe('tomorrow');                        // 10 AM CDT Oct 21
    expect(bucketOf(ev('2026-10-22T15:00:00Z'), now, CHI)).toBeNull();
  });

  it('drops an event once it has ended (explicit end)', () => {
    const e = ev('2026-10-21T00:00:00Z', '2026-10-21T02:00:00Z'); // 7-9 PM CDT
    expect(bucketOf(e, at('2026-10-21T01:59:00Z'), CHI)).toBe('tonight');
    expect(bucketOf(e, at('2026-10-21T02:00:00Z'), CHI)).toBeNull();
  });

  it('no-end event lasts 3 h', () => {
    const e = ev('2026-10-21T00:00:00Z'); // 7 PM CDT
    expect(bucketOf(e, at('2026-10-21T02:59:00Z'), CHI)).toBe('tonight');
    expect(bucketOf(e, at('2026-10-21T03:00:00Z'), CHI)).toBeNull();
  });

  it('16:59 vs 17:00 local start decides tonight', () => {
    expect(bucketOf(ev('2026-10-20T21:59:00Z', '2026-10-20T23:00:00Z'), now, CHI)).toBeNull();      // 4:59 PM
    expect(bucketOf(ev('2026-10-20T22:00:00Z', '2026-10-21T00:00:00Z'), now, CHI)).toBe('tonight'); // 5:00 PM
  });

  it('23:59 and 00:01 local: "today" rolls over at the town midnight, not UTC midnight', () => {
    const lateEvent = ev('2026-10-21T04:00:00Z', '2026-10-21T08:00:00Z'); // 11 PM Oct 20 - 3 AM Oct 21 CDT
    const nextDay = ev('2026-10-21T15:00:00Z');                           // 10 AM Oct 21 CDT
    expect(bucketOf(lateEvent, at('2026-10-21T04:59:00Z'), CHI)).toBe('tonight'); // 11:59 PM Oct 20
    expect(bucketOf(nextDay, at('2026-10-21T04:59:00Z'), CHI)).toBe('tomorrow');
    expect(bucketOf(nextDay, at('2026-10-21T05:01:00Z'), CHI)).toBeNull();        // 12:01 AM Oct 21: now today, before 17:00
    expect(bucketOf(lateEvent, at('2026-10-21T05:01:00Z'), CHI)).toBeNull();      // started yesterday-local
  });

  it('uses each town\'s zone', () => {
    const e = ev('2026-10-21T01:00:00Z', '2026-10-21T03:00:00Z'); // 6 PM PDT Oct 20 / 7 PM MDT / 8 PM CDT
    const n = at('2026-10-20T19:25:00Z');
    expect(bucketOf(e, n, LA)).toBe('tonight');
    expect(bucketOf(e, n, DEN)).toBe('tonight');
    expect(bucketOf(e, n, CHI)).toBe('tonight');
  });
});

describe('all-day events', () => {
  it('no-end event starting at local midnight lasts to the next local midnight', () => {
    const e = { start: '2026-10-20T05:00:00Z' }; // 00:00 CDT Oct 20
    expect(eventEndsAt(e, CHI).toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(hasEnded(e, at('2026-10-21T04:59:00Z'), CHI)).toBe(false);
    expect(hasEnded(e, at('2026-10-21T05:00:00Z'), CHI)).toBe(true);
  });
});

describe('DST fall-back, Sun 2026-11-01 (Chicago 01:00-02:00 repeats)', () => {
  it('local day number is stable across the repeated hour', () => {
    expect(localDayNumber(at('2026-11-01T05:30:00Z'), CHI)).toBe(localDayNumber(at('2026-11-01T06:30:00Z'), CHI));
    expect(localDayNumber(at('2026-11-02T05:59:00Z'), CHI)).toBe(localDayNumber(at('2026-11-01T06:00:00Z'), CHI));
    expect(localDayNumber(at('2026-11-02T06:00:00Z'), CHI)).toBe(localDayNumber(at('2026-11-01T06:00:00Z'), CHI) + 1);
  });
  it('an event spanning the repeated hour ends on the instant, not the wall clock', () => {
    const e = { start: '2026-11-01T05:30:00Z', end: '2026-11-01T07:30:00Z' }; // 12:30 AM CDT -> 1:30 AM CST (3h wall? 1h real+...)
    expect(hasEnded(e, at('2026-11-01T07:29:00Z'), CHI)).toBe(false);
    expect(hasEnded(e, at('2026-11-01T07:30:00Z'), CHI)).toBe(true);
  });
  it('all-day event on the 25-hour day lasts the full 25 hours', () => {
    const e = { start: '2026-11-01T05:00:00Z' }; // 00:00 CDT Nov 1
    expect(eventEndsAt(e, CHI).toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });
});

describe('counts and relative labels', () => {
  const now = at('2026-10-20T19:25:00Z'); // 2:25 PM CDT
  const events = [
    { start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z' }, // 9 AM, ended
    { start: '2026-10-20T18:00:00Z', end: '2026-10-20T21:00:00Z' }, // 1 PM, in progress
    { start: '2026-10-21T00:30:00Z' },                              // 7:30 PM tonight
    { start: '2026-10-21T15:00:00Z' },                              // tomorrow
  ];
  it('countToday / countTonight skip ended events', () => {
    expect(countToday(events, now, CHI)).toBe(2);
    expect(countTonight(events, now, CHI)).toBe(1);
  });
  it('relativeDayLabel counts town-local days', () => {
    expect(relativeDayLabel(at('2026-10-21T04:59:00Z'), now, CHI)).toBe('today');
    expect(relativeDayLabel(at('2026-10-21T05:01:00Z'), now, CHI)).toBe('tomorrow');
    expect(relativeDayLabel(at('2026-10-23T18:00:00Z'), now, CHI)).toBe('in 3 days');
  });
});
