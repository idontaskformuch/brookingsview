import { describe, expect, it } from 'vitest';
import { resolveLegacyMeetingRedirect } from './_shared';
import duplicateStoryRedirects from './duplicate-story-redirects.json';

// 2026-10-14, see .claude/state.md's "meeting 12940/13790" -- a real
// eSCRIBE content_hash bug let the same real meeting get scraped twice
// under two different hashes, producing two `stories` rows. Hand-maintained
// (a one-off dedup decision, same as facility-redirects.json), not bulk
// script output like event-series-redirects.json/legacy-meeting-redirects.json
// -- so this file also asserts the map's shape directly, not just the
// lookup mechanics (already fully covered generically, see
// legacy-meeting-redirect.test.ts).

describe('duplicate-story-redirects.json', () => {
  it('is a non-empty map of old meeting-story slugs to canonical meeting-story slugs', () => {
    const entries = Object.entries(duplicateStoryRedirects as Record<string, string>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [oldSlug, canonicalSlug] of entries) {
      expect(oldSlug).toMatch(/^meeting-/);
      expect(canonicalSlug).toMatch(/^meeting-/);
      expect(canonicalSlug).not.toBe(oldSlug);
    }
  });

  it('resolves the real 12940/13790 entry to its canonical /s/ path', () => {
    const path = resolveLegacyMeetingRedirect(
      '/s/meeting-2026-09-24-12940/', duplicateStoryRedirects as Record<string, string>,
    );
    expect(path).toBe('/s/meeting-2026-09-24-13790/');
  });
});
