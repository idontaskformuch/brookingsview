import { describe, expect, it } from 'vitest';
import { occurrenceDay } from './holiday-calendar';
import { holidayPageDef } from '../config/holiday-pages/calendar';

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const def = holidayPageDef('thanksgiving')!;

describe('Thanksgiving Day (shared date rule with the photo pool)', () => {
  it('is the fourth Thursday of November', () => {
    expect(iso(occurrenceDay(def, 2026))).toBe('2026-11-26');
    expect(iso(occurrenceDay(def, 2025))).toBe('2025-11-27');
    expect(iso(occurrenceDay(def, 2027))).toBe('2027-11-25');
    expect(iso(occurrenceDay(def, 2023))).toBe('2023-11-23'); // November starts on a Wednesday
    expect(iso(occurrenceDay(def, 2022))).toBe('2022-11-24'); // November starts on a Tuesday
  });
});
