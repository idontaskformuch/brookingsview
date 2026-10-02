import { describe, expect, it } from 'vitest';
import { isAiWrittenContent, CONTENT_TRACK_TYPES, countdown } from './db';

const CHI = 'America/Chicago';

describe('isAiWrittenContent', () => {
  it('is true for every Content Track type (reviews/recipes/editorials/columns)', () => {
    for (const sourceType of CONTENT_TRACK_TYPES) {
      expect(isAiWrittenContent(sourceType)).toBe(true);
    }
  });

  it('is false for scraped/derived types that are not AI-written prose', () => {
    expect(isAiWrittenContent('event')).toBe(false);
    expect(isAiWrittenContent('meeting')).toBe(false);
    expect(isAiWrittenContent('alert')).toBe(false);
  });

  it('is false for digest types outside the daily Content Track rotation', () => {
    // home_sales_digest/sports_digest are generated on their own cadence,
    // not part of CONTENT_TRACK_TYPES -- see that constant's own comment.
    expect(isAiWrittenContent('home_sales_digest')).toBe(false);
    expect(isAiWrittenContent('sports_digest')).toBe(false);
  });
});

describe('countdown (item B3: town-local calendar days, not raw elapsed time)', () => {
  it('returns "today" for a game later THIS SAME local day, even just after local midnight', () => {
    // The real bug this fix closes: at 00:30 CDT, a 7pm CDT start the same
    // local day is ~18.5 real hours away -- the old Math.ceil(hours/24)
    // implementation rounded that up to 1 ("tomorrow"), which is wrong: it's
    // today. 2026-08-27T05:30:00Z = 00:30 CDT; 2026-08-28T00:00:00Z = 7pm
    // CDT Aug 27 (same local day as `now`).
    const now = new Date('2026-08-27T05:30:00Z');
    expect(countdown('2026-08-28T00:00:00Z', now, CHI)).toBe('today');
  });

  it('returns "today" for a start time earlier than `now` the same local day', () => {
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-27T15:00:00Z', now, CHI)).toBe('today');
  });

  it('returns "tomorrow" for the very next town-local calendar day', () => {
    // now = 2026-08-27T19:00:00Z = 2pm CDT Aug 27; target = 7pm CDT Aug 28.
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-29T00:00:00Z', now, CHI)).toBe('tomorrow');
  });

  it('returns "in N days" for a game further out, counted in local calendar days', () => {
    const now = new Date('2026-08-27T19:00:00Z'); // 2pm CDT Aug 27
    expect(countdown('2026-09-01T00:00:00Z', now, CHI)).toBe('in 4 days'); // 7pm CDT Aug 31
  });

  it('is timezone-aware, not UTC -- the same instant counts differently in a different town timezone', () => {
    // 2026-08-28T05:00:00Z is midnight CDT at the START of Aug 28 (Chicago)
    // but still 10pm PDT on Aug 27 (Los Angeles) -- a real cross-midnight
    // divergence between towns for the identical instant.
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-28T05:00:00Z', now, CHI)).toBe('tomorrow');
    expect(countdown('2026-08-28T05:00:00Z', now, 'America/Los_Angeles')).toBe('today');
  });

  it('returns an empty string for a null value', () => {
    expect(countdown(null, new Date(), CHI)).toBe('');
  });
});
