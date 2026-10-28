import { describe, expect, it } from 'vitest';
import { meetingCardTitle } from './meeting-title';

describe('meetingCardTitle', () => {
  it('drops the trailing date from a meeting title', () => {
    expect(meetingCardTitle('Hillhead Area Partnership — Tue 3 Nov 2026', 'meeting')).toBe('Hillhead Area Partnership');
    expect(meetingCardTitle('Planning Applications Committee — Tue 27 Oct 2026', 'meeting')).toBe('Planning Applications Committee');
    expect(meetingCardTitle('City Council — Thu, Aug 27, 2026', 'meeting')).toBe('City Council');
    expect(meetingCardTitle('City Council — August 27', 'meeting')).toBe('City Council');
  });
  it('leaves other types, and titles without a trailing date, alone', () => {
    expect(meetingCardTitle('Hillhead Area Partnership — Tue 3 Nov 2026', 'event')).toBe('Hillhead Area Partnership — Tue 3 Nov 2026');
    expect(meetingCardTitle('Budget Workshop — Main Hall', 'meeting')).toBe('Budget Workshop — Main Hall');
  });
});
