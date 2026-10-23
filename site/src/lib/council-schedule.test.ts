import { describe, expect, it } from 'vitest';
import { expectedMeetings, nthTuesday } from './council-schedule';

const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('nthTuesday', () => {
  it('finds the 2nd, 3rd and 4th Tuesday of October 2026', () => {
    expect(iso(nthTuesday(2026, 10, 2))).toBe('2026-10-13');
    expect(iso(nthTuesday(2026, 10, 3))).toBe('2026-10-20');
    expect(iso(nthTuesday(2026, 10, 4))).toBe('2026-10-27');
  });
  it('handles a month that starts on a Tuesday (September 2026)', () => {
    expect(iso(nthTuesday(2026, 9, 1))).toBe('2026-09-01');
    expect(iso(nthTuesday(2026, 9, 2))).toBe('2026-09-08');
  });
});

describe('expectedMeetings', () => {
  it('lists regular (2nd, 4th) and study (3rd) Tuesdays from Oct 22, 2026, in order', () => {
    const m = expectedMeetings(d(2026, 10, 22), 61).map((x) => `${iso(x.date)} ${x.kind}`);
    expect(m).toEqual([
      '2026-10-27 regular',
      '2026-11-10 regular',
      '2026-11-17 study',
      '2026-11-24 regular',
      '2026-12-08 regular',
      '2026-12-15 study',
      '2026-12-22 regular',
    ]);
  });
  it('has no study sessions in June, July or August', () => {
    const m = expectedMeetings(d(2026, 6, 1), 92);
    expect(m.some((x) => x.kind === 'study')).toBe(false);
    expect(m.filter((x) => x.kind === 'regular').length).toBe(6);
  });
  it('includes a meeting on the start day and crosses the year change', () => {
    const m = expectedMeetings(d(2026, 12, 22), 40).map((x) => iso(x.date));
    expect(m[0]).toBe('2026-12-22');
    expect(m).toContain('2027-01-12');
  });
});
