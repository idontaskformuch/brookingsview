import { describe, expect, it } from 'vitest';
import { resolveLegacyMeetingRedirect } from './_shared';
import eventSeriesRedirects from './event-series-redirects.json';

// Events correctness Phase 1: db/migrations/051_event_series_supersede.sql +
// scripts/merge_recurring_event_duplicates.py. worker.ts deliberately reuses
// resolveLegacyMeetingRedirect() against this map instead of a second
// near-identical function -- that function is already fully covered
// generically (see legacy-meeting-redirect.test.ts), so this file only
// confirms the REAL generated map has the expected shape and that a real
// entry resolves, not the lookup mechanics again.

describe('event-series-redirects.json', () => {
  // Despite the filename, NOT every canonical target is a series page --
  // scripts/merge_recurring_event_duplicates.py's find_source_url_
  // duplicate_groups() (Events correctness Phase 1, point 2) also writes
  // individual-to-individual entries here (a one-time event re-scraped
  // after the organizer corrected its own date, e.g. "BPN October Meetup -
  // Fly Boy Donuts" -- confirmed live 2026-10-08). Both shapes are a plain
  // old-slug -> canonical-slug lookup either way (resolveLegacyMeetingRedirect()
  // doesn't care which), so this only asserts both sides are real event
  // slugs, not that the target is specifically a series.
  it('is a non-empty map of old event slugs to canonical event slugs', () => {
    const entries = Object.entries(eventSeriesRedirects as Record<string, string>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [oldSlug, canonicalSlug] of entries) {
      expect(oldSlug).toMatch(/^event-/);
      expect(canonicalSlug).toMatch(/^event-/);
      expect(canonicalSlug).not.toBe(oldSlug);
    }
  });

  it('resolves a real entry to its canonical /s/ path via the shared redirect resolver', () => {
    const path = resolveLegacyMeetingRedirect(
      '/s/event-100756/', eventSeriesRedirects as Record<string, string>,
    );
    expect(path).toBe('/s/event-series-c58028a9cbe64a93/');
  });
});
