import { afterEach, describe, expect, it, vi } from 'vitest';

// Owner 2026-10-28: the Glasgow city-hall card said "Tue 3 November" while the page said "Tue 3 November at 1pm".
describe('formatMeetingKicker', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('Glasgow: day plus the clock time when one was read, day only for a date with no time', async () => {
    vi.stubEnv('SITE_CITY', 'glasgow');
    vi.resetModules();
    const { formatMeetingKicker } = await import('./db');
    expect(formatMeetingKicker('2026-11-03T13:00:00Z')).toBe('Tue 3 November · 1pm');
    expect(formatMeetingKicker('2026-11-03T00:00:00Z')).toBe('Tue 3 November');
  });
});
