// Owner 2026-11-19 ("rätta /this-week/ och /events/past/ med lib/event-occurrence.mjs"): the LISTS of days drop a past occurrence
// superseded by its series exactly like the counts did before 1d0d1b8f. Moreno Valley's archive weeks counted 4-27 items although the
// library calendar alone had ~30 a week (week of 9 Nov: 8 counted, 23 dropped). Lists use listedEventRows(): the counted occurrences,
// plus a series row only when none of its occurrences falls on the series' own date (Brookings event-series-bab905fc30a08cc1 has no
// occurrence rows at all and must stay). QA: qa/checks.json "logic.event-occurrence-lists". The week-count and db tests fail on
// 1d0d1b8f (week-count.mjs and getStoriesForWeekly left every superseded row out; getEventArchiveStories did not exist).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listedEventRows } from './event-occurrence.mjs';
import { countWeekItems } from './week-count.mjs';

// Real rows (live DB, SELECT 2026-11-19), source_type 'event'.
const ROWS = [
  // moreno_valley_ca: two occurrences of a library series, both superseded by the series ...
  { slug: 'event-6187', title: 'Moreno Valley: IRIS PLAZA: Toddler Time', occurs_at: '2026-11-16T18:00:00Z', superseded_by_slug: 'event-series-420a9ebc7c2214bd' },
  { slug: 'event-6216', title: 'Moreno Valley: IRIS PLAZA: Toddler Time', occurs_at: '2026-11-23T18:00:00Z', superseded_by_slug: 'event-series-420a9ebc7c2214bd' },
  // ... and the series row, dated at its next occurrence = event-6216's instant (listing both would show Toddler Time twice on 23 Nov)
  { slug: 'event-series-420a9ebc7c2214bd', title: 'Moreno Valley: IRIS PLAZA: Toddler Time', occurs_at: '2026-11-23T18:00:00Z', superseded_by_slug: null },
  // brookings_sd: a series with no occurrence rows at all
  { slug: 'event-series-bab905fc30a08cc1', title: 'EBC Trivia Night', occurs_at: '2026-11-26T01:00:00Z', superseded_by_slug: null },
  // brookings_sd: a cross-source duplicate merged into another event-N, and a plain event
  { slug: 'event-289033', title: 'Spice Club: Black Pepper', occurs_at: '2026-10-26T00:00:00Z', superseded_by_slug: 'event-303510' },
  { slug: 'event-303556', title: 'Jazz at Lincoln Center Orchestra with Wynton Marsalis', occurs_at: '2026-10-12T00:00:00Z', superseded_by_slug: null },
].map((r, i) => ({ id: i + 1, source_type: 'event', source_url: null, venue_raw: null, ...r }));

const TZ = 'America/Los_Angeles';
const LISTED = ['event-6187', 'event-6216', 'event-series-bab905fc30a08cc1', 'event-303556'];

describe('listedEventRows', () => {
  it('keeps occurrences a series replaced and a series without an occurrence on its date; drops the covered series and the duplicate', () => {
    expect(listedEventRows(ROWS, TZ).map((r) => r.slug)).toEqual(LISTED);
  });
});

describe('countWeekItems counts an occurrence a series replaced', () => {
  it('Moreno week of 16 Nov: event-6187 counts (0 on 1d0d1b8f); week of 23 Nov: Toddler Time once, not twice', () => {
    const counts = countWeekItems({ stories: ROWS.slice(0, 3) }, TZ, true);
    expect(counts.get('2026-w47')).toBe(1);
    expect(counts.get('2026-w48')).toBe(1);
  });
});

vi.mock('@neondatabase/serverless', () => ({
  neon: () => Object.assign(async () => ROWS.map((r) => ({ ...r })), { query: async () => ROWS.map((r) => ({ ...r })) }),
}));

describe('db lists (the SQL no longer drops superseded event rows)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('getStoriesForWeekly(["event"]) and getEventArchiveStories() return exactly the listed rows', async () => {
    vi.resetModules();
    vi.stubEnv('SITE_CITY', 'moreno_valley_ca');
    const db = await import('./db');
    expect((await db.getStoriesForWeekly(['event'])).map((s) => s.slug)).toEqual(LISTED);
    expect((await db.getEventArchiveStories()).map((s) => s.slug)).toEqual(LISTED);
  });
});
