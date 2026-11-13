import { describe, it, expect, vi } from 'vitest';

vi.mock('./db', () => ({ getUpcomingStories: vi.fn() }));
import { canCalendarEvent, getCalendarEvents, icsLimitWarning, EVENT_ICS_LIMIT } from './event-calendar';
import { getUpcomingStories } from './db';
import type { Story } from './db';

const TZ = 'America/Los_Angeles';
// Real rows, moreno_valley_ca, read 2026-11-13.
const EVAN_HONER = { id: 4166, slug: 'event-327261', title: 'Evan Honer', source_type: 'event', is_recurring_series: false,
  occurs_at: '2026-11-15T02:00:00Z', ends_at: '2026-11-15T02:00:00Z' } as unknown as Story;
const YOGA = { id: 3620, slug: 'event-series-4c939cc384e8dd2a', title: 'Yoga in the Backyard', source_type: 'event', is_recurring_series: true,
  occurs_at: '2026-11-13T17:30:00Z', ends_at: null } as unknown as Story;

describe('canCalendarEvent (one rule for the .ics file and its link, F18 2026-11-13)', () => {
  it('an event that has not ended gets a calendar file', () => {
    expect(canCalendarEvent(EVAN_HONER, new Date('2026-11-14T20:00:00Z'), TZ)).toBe(true);
  });
  it('an event that has ended does not', () => {
    expect(canCalendarEvent(EVAN_HONER, new Date('2026-11-15T12:00:00Z'), TZ)).toBe(false);
  });
  it('a recurring series has no single date to add', () => {
    expect(canCalendarEvent(YOGA, new Date('2026-11-13T08:00:00Z'), TZ)).toBe(false);
  });
  it('an undated event has none either (only occurs_at changed from the real row)', () => {
    expect(canCalendarEvent({ ...EVAN_HONER, occurs_at: null } as unknown as Story, new Date('2026-11-14T20:00:00Z'), TZ)).toBe(false);
  });
});

describe('the .ics cap (owner 2026-11-13)', () => {
  it('the read leaves recurring series out before the cap, so the cap counts only dated events', async () => {
    vi.mocked(getUpcomingStories).mockResolvedValue([]);
    await getCalendarEvents();
    expect(getUpcomingStories).toHaveBeenCalledWith(['event'], EVENT_ICS_LIMIT, { excludeRecurring: true });
  });
  it('a read that fills the cap warns, one under it does not', () => {
    expect(icsLimitWarning(EVENT_ICS_LIMIT, 'moreno_valley_ca')).toContain('moreno_valley_ca: read 500 upcoming events = EVENT_ICS_LIMIT');
    expect(icsLimitWarning(EVENT_ICS_LIMIT - 1, 'moreno_valley_ca')).toBeNull();
  });
});
