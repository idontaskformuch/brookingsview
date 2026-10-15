import { describe, expect, it } from 'vitest';
import { calendarDateParts } from './calendar-date';

describe('calendarDateParts', () => {
  it('returns null for a null value', () => {
    expect(calendarDateParts(null)).toBeNull();
  });

  it('parses a bare "YYYY-MM-DD" string without any timezone shift', () => {
    expect(calendarDateParts('2026-09-07')).toEqual({ y: 2026, m: 8, d: 7 });
  });

  it('parses the date portion of a longer string (e.g. a DATE column round-tripped with a time)', () => {
    expect(calendarDateParts('2026-09-07T00:00:00.000Z')).toEqual({ y: 2026, m: 8, d: 7 });
  });

  it('reads a real Date object by its own local y/m/d, not a re-parsed string', () => {
    expect(calendarDateParts(new Date(2026, 8, 7))).toEqual({ y: 2026, m: 8, d: 7 });
  });
});
