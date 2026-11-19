// Owner Beslut 8 (2026-11-19): count event OCCURRENCES. Born from the Fas 4 finding that Moreno Valley's weeks 3 Aug-6 Sep 2026 counted
// 0 events although the library and city calendars had ~33 a week: every occurrence was superseded by its series story, whose occurs_at
// is the next occurrence. QA: qa/checks.json "logic.event-occurrence-count". The db tests fail on 85885045's db.ts (the superseded rows
// were dropped in SQL there, so the mocked rows all came back; here the filter is in TS and must keep exactly the occurrences).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCountedOccurrence } from './event-occurrence.mjs';

// Real rows (live DB, SELECT 2026-11-19).
const ROWS = [
  // moreno_valley_ca: one occurrence of a library series, superseded by the series
  { slug: 'event-6164', title: 'Moreno Valley: IRIS PLAZA: Toddler Time', occurs_at: '2026-11-09T18:00:00Z', superseded_by_slug: 'event-series-420a9ebc7c2214bd' },
  // ... and the series row itself, dated at its next occurrence
  { slug: 'event-series-420a9ebc7c2214bd', title: 'Moreno Valley: IRIS PLAZA: Toddler Time', occurs_at: '2026-11-23T18:00:00Z', superseded_by_slug: null },
  // brookings_sd: a cross-source duplicate merged into another event-N
  { slug: 'event-289033', title: 'Spice Club: Black Pepper', occurs_at: '2026-10-26T00:00:00Z', superseded_by_slug: 'event-303510' },
  // brookings_sd: a plain event (event-303556, Jazz at Lincoln Center Orchestra with Wynton Marsalis)
  { slug: 'event-303556', title: 'Jazz at Lincoln Center Orchestra with Wynton Marsalis', occurs_at: '2026-10-12T00:00:00Z', superseded_by_slug: null },
];

describe('isCountedOccurrence', () => {
  it('counts a plain event and an occurrence superseded by its series; never the series row or a merged duplicate', () => {
    expect(ROWS.filter(isCountedOccurrence).map((r) => r.slug)).toEqual(['event-6164', 'event-303556']);
  });
});

vi.mock('@neondatabase/serverless', () => ({
  neon: () => Object.assign(async () => ROWS.map((r) => ({ ...r })), { query: async () => ROWS.map((r) => ({ ...r })) }),
}));

describe('db counts occurrences (the SQL no longer drops superseded rows)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('getEventOccurrencesBetween and getEventStoriesOccurringBetween keep exactly the occurrences', async () => {
    vi.resetModules();
    vi.stubEnv('SITE_CITY', 'moreno_valley_ca');
    const db = await import('./db');
    const a = new Date('2026-10-01T00:00:00Z');
    const b = new Date('2026-12-01T00:00:00Z');
    expect(await db.getEventOccurrencesBetween(a, b)).toEqual(['2026-11-09T18:00:00Z', '2026-10-12T00:00:00Z']);
    expect((await db.getEventStoriesOccurringBetween(a, b)).map((s) => s.slug)).toEqual(['event-6164', 'event-303556']);
  });
});
