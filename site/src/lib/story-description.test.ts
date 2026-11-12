import { describe, expect, it } from 'vitest';
import { capAtWord, factsDescription, DESCRIPTION_CAP } from './story-description';

const GB = { timezone: 'Europe/London', meetingsHaveTime: true, locale: 'en-GB' as const };
const DENVER = { timezone: 'America/Denver', meetingsHaveTime: true, locale: 'en-US' as const };
const CHICAGO_BARE = { timezone: 'America/Chicago', meetingsHaveTime: false, locale: 'en-US' as const };

describe('factsDescription (QA build.meta-missing, 2026-11-12)', () => {
  it('Glasgow meeting: the title names the day, the place is a manner', () => {
    expect(factsDescription({
      title: 'Planning Applications Committee — Tue 17 Nov 2026', source_type: 'meeting',
      occurs_at: '2026-11-17T10:00:00Z', meta: { venue: 'By video conference' },
    }, GB)).toBe('Planning Applications Committee — Tue 17 Nov 2026, by video conference.');
  });

  it('Glasgow event: title at venue, local day', () => {
    expect(factsDescription({
      title: 'Bonnie "Prince" Billy', source_type: 'event', occurs_at: '2026-11-14T19:30:00Z', meta: { venue: 'Old Fruitmarket' },
    }, GB)).toBe('Bonnie "Prince" Billy at Old Fruitmarket, Saturday 14 Nov 2026.');
  });

  it("an evening meeting is on the town's day, not UTC's", () => {
    expect(factsDescription({
      title: 'City Council Study Session', source_type: 'meeting', occurs_at: '2026-10-21T00:00:00Z', meta: null,
    }, DENVER)).toBe('City Council Study Session, Tuesday, Oct 20, 2026.');
    // Brookings: bare date at UTC midnight
    expect(factsDescription({
      title: 'City Council', source_type: 'meeting', occurs_at: '2026-11-10T00:00:00Z', meta: null,
    }, CHICAGO_BARE)).toBe('City Council, Tuesday, Nov 10, 2026.');
  });

  it('a missing place or day is left out with its separator, never a dangling comma', () => {
    expect(factsDescription({ title: 'Story Hour', source_type: 'event', occurs_at: null, meta: { venue: 'Main Library' } }, DENVER))
      .toBe('Story Hour at Main Library.');
    expect(factsDescription({ title: 'Story Hour', source_type: 'event', occurs_at: '2026-11-14T17:00:00Z', meta: null, venue_raw: null }, DENVER))
      .toBe('Story Hour, Saturday, Nov 14, 2026.');
    expect(factsDescription({ title: 'Burn ban lifted.', source_type: 'alert', occurs_at: null }, DENVER)).toBe('Burn ban lifted.');
    expect(factsDescription({ title: 'Story Hour', source_type: 'event', occurs_at: null, meta: { venue: '  ' } }, DENVER))
      .toBe('Story Hour.');
  });

  it('venue_raw is used when meta has no venue, and a venue already in the title is not repeated', () => {
    expect(factsDescription({ title: 'Jazz Night', source_type: 'event', occurs_at: null, venue_raw: 'Mitchell Library' }, GB))
      .toBe('Jazz Night at Mitchell Library.');
    expect(factsDescription({ title: 'Murder Mystery at Mitchell Library', source_type: 'event', occurs_at: null, meta: { venue: 'Mitchell Library' } }, GB))
      .toBe('Murder Mystery at Mitchell Library.');
  });

  it('is cut at about 155 characters on a word boundary', () => {
    const title = 'Economy, Housing, Transport and Regeneration City Policy Committee special session on the draft budget and the city centre transformation plan';
    const d = factsDescription({ title, source_type: 'meeting', occurs_at: '2026-11-17T10:00:00Z', meta: { venue: 'City Chambers, Glasgow' } }, GB);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_CAP);
    expect(d.endsWith('…')).toBe(true);
    expect(title.startsWith(d.slice(0, -1)) || `${title} at City Chambers`.startsWith(d.slice(0, -1))).toBe(true);
    expect(d).not.toMatch(/[\s,]…$/);
  });

  it('capAtWord leaves short text alone', () => {
    expect(capAtWord('Short.')).toBe('Short.');
  });
});
