import { describe, expect, it } from 'vitest';
import { meetingDayKey, meetingDayParts } from './meeting-day.mjs';

describe('meetingDayKey', () => {
  it("a town with meeting times reads the instant in its own zone (live 2026-11-12: evening meetings sat a day late)", () => {
    // Broomfield City Council Tue Nov 10 6pm MST
    expect(meetingDayKey('2026-11-11T01:00:00Z', 'America/Denver', true)).toBe('2026-11-10');
    // Moreno Valley Planning Commission Thu Nov 12 6pm PST
    expect(meetingDayKey('2026-11-13T02:00:00Z', 'America/Los_Angeles', true)).toBe('2026-11-12');
    // Glasgow: GMT in November, BST in summer -- an 11pm BST meeting stays on its day
    expect(meetingDayKey('2026-06-10T22:00:00Z', 'Europe/London', true)).toBe('2026-06-10');
    expect(meetingDayKey('2026-11-10T13:00:00Z', 'Europe/London', true)).toBe('2026-11-10');
  });

  it('a bare-date town (Brookings) reads the UTC date with no conversion', () => {
    // UTC midnight is the previous evening in Chicago; the date is the stored one
    expect(meetingDayKey('2026-11-10T00:00:00Z', 'America/Chicago', false)).toBe('2026-11-10');
    // Legistar's noon-UTC anchor
    expect(meetingDayKey('2026-11-10T12:00:00Z', 'America/Chicago', false)).toBe('2026-11-10');
  });

  it('takes a Date as well as a string, and gives null without a date', () => {
    expect(meetingDayParts(new Date('2026-11-11T01:00:00Z'), 'America/Denver', true)).toEqual({ y: 2026, m: 11, d: 10 });
    expect(meetingDayKey(null, 'America/Denver', true)).toBeNull();
    expect(meetingDayKey('', 'America/Denver', true)).toBeNull();
    expect(meetingDayKey('not a date', 'America/Denver', true)).toBeNull();
  });
});
