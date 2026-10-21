import { describe, expect, it } from 'vitest';
import { matchesTopEvent, selectTopEvent } from './top-event';

const CHI = 'America/Chicago';
const cfg = { patterns: ['Hobo Day'], leadDays: 14 };
// story 3941: "114th Hobo Day", stored as Sat Oct 24 00:00 local (all day, no end)
const HOBO = { title: '114th Hobo Day', occurs_at: '2026-10-24T05:00:00Z', ends_at: null };
const OTHER = { title: 'Pumpkin Patch Saturday', occurs_at: '2026-10-24T15:00:00Z' };

describe('selectTopEvent', () => {
  it('matches case-insensitively and ignores unrelated events', () => {
    expect(matchesTopEvent('114th HOBO DAY parade', ['hobo day'])).toBe(true);
    expect(selectTopEvent([OTHER, HOBO], cfg, new Date('2026-10-20T19:00:00Z'), CHI)).toBe(HOBO);
  });
  it('appears leadDays ahead, not before', () => {
    expect(selectTopEvent([HOBO], cfg, new Date('2026-10-10T17:00:00Z'), CHI)).toBe(HOBO);   // 14 days
    expect(selectTopEvent([HOBO], cfg, new Date('2026-10-09T17:00:00Z'), CHI)).toBeNull();   // 15 days
  });
  it('is shown all day on Hobo Day and gone at the next town midnight', () => {
    expect(selectTopEvent([HOBO], cfg, new Date('2026-10-24T05:01:00Z'), CHI)).toBe(HOBO);   // 00:01 Sat
    expect(selectTopEvent([HOBO], cfg, new Date('2026-10-25T04:59:00Z'), CHI)).toBe(HOBO);   // 23:59 Sat
    expect(selectTopEvent([HOBO], cfg, new Date('2026-10-25T05:01:00Z'), CHI)).toBeNull();   // 00:01 Sun
  });
  it('a town without config shows nothing', () => {
    expect(selectTopEvent([HOBO], undefined, new Date('2026-10-20T19:00:00Z'), CHI)).toBeNull();
    expect(selectTopEvent([HOBO], { patterns: [], leadDays: 14 }, new Date('2026-10-20T19:00:00Z'), CHI)).toBeNull();
  });
  it('works for any town zone (config-driven, nothing Brookings-specific)', () => {
    const ev = { title: 'Broomfield Days', occurs_at: '2026-06-06T06:00:00Z' }; // 00:00 MDT
    const c = { patterns: ['broomfield days'], leadDays: 7 };
    expect(selectTopEvent([ev], c, new Date('2026-06-02T18:00:00Z'), 'America/Denver')).toBe(ev);
    expect(selectTopEvent([ev], c, new Date('2026-06-07T06:01:00Z'), 'America/Denver')).toBeNull();
  });
});
