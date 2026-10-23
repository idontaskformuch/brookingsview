import { describe, expect, it } from 'vitest';
import {
  isPastThanksgivingWindow, isThanksgivingSeason, thanksgivingDay, thanksgivingWeekMonday,
} from './thanksgiving';

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('thanksgivingDay', () => {
  it('is the fourth Thursday of November', () => {
    expect(iso(thanksgivingDay(2026))).toBe('2026-11-26');
    expect(iso(thanksgivingDay(2025))).toBe('2025-11-27');
    expect(iso(thanksgivingDay(2027))).toBe('2027-11-25');
    expect(iso(thanksgivingDay(2023))).toBe('2023-11-23'); // November starts on a Wednesday
    expect(iso(thanksgivingDay(2022))).toBe('2022-11-24'); // November starts on a Tuesday
  });
  it('the week Monday is three days before', () => {
    expect(iso(thanksgivingWeekMonday(2026))).toBe('2026-11-23');
  });
});

describe('page window (2026 facts)', () => {
  it('is in season from November 1 and noindex a week after Thanksgiving', () => {
    expect(isThanksgivingSeason(Date.UTC(2026, 9, 31))).toBe(false);
    expect(isThanksgivingSeason(Date.UTC(2026, 10, 1))).toBe(true);
    expect(isThanksgivingSeason(Date.UTC(2026, 11, 2, 23))).toBe(true);
    expect(isPastThanksgivingWindow(Date.UTC(2026, 11, 3))).toBe(true);
    expect(isThanksgivingSeason(Date.UTC(2026, 11, 3))).toBe(false);
  });
});
