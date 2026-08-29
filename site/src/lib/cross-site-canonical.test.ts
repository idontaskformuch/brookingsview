import { describe, expect, it } from 'vitest';
import { canonicalUrlForStory, CROSS_SITE_CANONICAL_ORIGINS } from './cross-site-canonical';
import { ALL_SITES } from './site-config';
import type { SourceType } from './db';

const SELF_URL = 'https://example-self.test/s/some-slug/';

describe('canonicalUrlForStory', () => {
  it('is self-canonical for a non-shared source_type regardless of town', () => {
    expect(canonicalUrlForStory('editorial', 'editorial-2026-08-28', 'brookings_sd', SELF_URL)).toBe(SELF_URL);
    expect(canonicalUrlForStory('meeting', 'meeting-123', 'moreno_valley_ca', SELF_URL)).toBe(SELF_URL);
  });

  it('is self-canonical when the current town IS the designated origin', () => {
    expect(canonicalUrlForStory('vardagsmiddag', 'vardagsmiddag-2026-08-28', 'brookings_sd', SELF_URL)).toBe(SELF_URL);
    expect(canonicalUrlForStory('media_recension', 'media_recension-2026-08-28', 'moreno_valley_ca', SELF_URL)).toBe(SELF_URL);
    expect(canonicalUrlForStory('vetenskap_kronika', 'vetenskap_kronika-2026-08-28', 'broomfield_co', SELF_URL)).toBe(SELF_URL);
  });

  it('points to the origin town, same slug, when this town is not the origin', () => {
    const url = canonicalUrlForStory('vardagsmiddag', 'vardagsmiddag-2026-08-28', 'moreno_valley_ca', SELF_URL);
    expect(url).toBe('https://brookingsview.com/s/vardagsmiddag-2026-08-28/');
  });

  it('covers all three shared types pointing away from a non-origin town', () => {
    expect(canonicalUrlForStory('vardagsmiddag', 'x', 'broomfield_co', SELF_URL))
      .toBe('https://brookingsview.com/s/x/');
    expect(canonicalUrlForStory('media_recension', 'x', 'brookings_sd', SELF_URL))
      .toBe('https://morenovalleyview.com/s/x/');
    expect(canonicalUrlForStory('vetenskap_kronika', 'x', 'moreno_valley_ca', SELF_URL))
      .toBe('https://broomfieldview.com/s/x/');
  });

  // The real property this whole mechanism exists to guarantee: no two
  // towns can ever both self-canonicalize the same shared content type --
  // exactly one origin per type, by construction, not by convention.
  it('no shared content type has more than one self-canonicalizing town', () => {
    const towns = ALL_SITES.map((s) => s.townId);
    for (const sourceType of Object.keys(CROSS_SITE_CANONICAL_ORIGINS) as SourceType[]) {
      const selfCanonicalTowns = towns.filter(
        (townId) => canonicalUrlForStory(sourceType, 'x', townId, SELF_URL) === SELF_URL,
      );
      expect(selfCanonicalTowns).toHaveLength(1);
    }
  });

  it('rotates origins across towns rather than naming one town for everything', () => {
    const origins = new Set(Object.values(CROSS_SITE_CANONICAL_ORIGINS));
    expect(origins.size).toBe(Object.keys(CROSS_SITE_CANONICAL_ORIGINS).length);
  });
});
