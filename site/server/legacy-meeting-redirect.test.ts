import { describe, expect, it } from 'vitest';
import { resolveLegacyMeetingRedirect } from './_shared';

// Real live example (AdSense remediation Phase B1): meeting 11179 was
// published under both "meeting-11179" (legacy) and
// "meeting-2026-06-16-11179" (dated, kept canonical).
const MAP = { 'meeting-11179': 'meeting-2026-06-16-11179', 'meeting-39': 'meeting-2026-07-07-39' };

describe('resolveLegacyMeetingRedirect', () => {
  it('redirects a known legacy slug to its canonical /s/ path', () => {
    expect(resolveLegacyMeetingRedirect('/s/meeting-11179/', MAP)).toBe('/s/meeting-2026-06-16-11179/');
  });

  it('returns null for a slug not in the map', () => {
    expect(resolveLegacyMeetingRedirect('/s/meeting-99999/', MAP)).toBeNull();
  });

  it('returns null for an unrelated path', () => {
    expect(resolveLegacyMeetingRedirect('/about/', MAP)).toBeNull();
    expect(resolveLegacyMeetingRedirect('/', MAP)).toBeNull();
  });

  it('never matches a slug that is already canonical', () => {
    // The canonical slug itself is never a KEY in the map (only ever a
    // value) -- confirm looking it up directly returns null, not a
    // self-redirect loop.
    expect(resolveLegacyMeetingRedirect('/s/meeting-2026-06-16-11179/', MAP)).toBeNull();
  });

  it('works with an empty map (the placeholder state before the cleanup script runs)', () => {
    expect(resolveLegacyMeetingRedirect('/s/meeting-11179/', {})).toBeNull();
  });
});
