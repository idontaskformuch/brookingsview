import { describe, expect, it } from 'vitest';
import { publicSlug, storyHref, hasOldPrefix } from './content-slugs';

describe('publicSlug', () => {
  it('maps all four old Swedish prefixes to their English equivalents', () => {
    expect(publicSlug('vardagsmiddag-2026-05-01')).toBe('recipe-2026-05-01');
    expect(publicSlug('vetenskap_kronika-2026-07-14')).toBe('science-column-2026-07-14');
    expect(publicSlug('kvick_essa-2026-03-02')).toBe('quick-essay-2026-03-02');
    expect(publicSlug('media_recension-2026-07-22')).toBe('review-2026-07-22');
  });

  it('is a no-op for a slug that already uses the new English prefix', () => {
    // The 12 vardagsmiddag rows migrated 2026-08-23 already look like this.
    expect(publicSlug('recipe-2026-09-01')).toBe('recipe-2026-09-01');
  });

  it('is a no-op for every other content type', () => {
    for (const slug of [
      'meeting-2026-08-27-11040', 'editorial-2026-09-29', 'culture_essay-2026-08-03',
      'alert-412', 'weekly-2026-w40', 'workplace-watch-amazon-2026-08',
      'home-sales-2026-09', 'university_digest-2026-09-15',
    ]) {
      expect(publicSlug(slug)).toBe(slug);
    }
  });

  it('only matches the prefix at the very start of the slug', () => {
    // A slug that happens to CONTAIN "media_recension" later, not as its
    // own prefix, must not be mangled.
    expect(publicSlug('editorial-about-media_recension-policy')).toBe('editorial-about-media_recension-policy');
  });

  it('preserves everything after the prefix exactly, including multiple dashes', () => {
    expect(publicSlug('kvick_essa-2026-03-02-extra-suffix')).toBe('quick-essay-2026-03-02-extra-suffix');
  });
});

describe('storyHref', () => {
  it('builds the full /s/ path with the public slug', () => {
    expect(storyHref('media_recension-2026-07-22')).toBe('/s/review-2026-07-22/');
  });

  it('passes through unaffected slugs unchanged', () => {
    expect(storyHref('meeting-2026-08-27-11040')).toBe('/s/meeting-2026-08-27-11040/');
  });
});

describe('hasOldPrefix', () => {
  it('is true for exactly the four old prefixes, false otherwise', () => {
    expect(hasOldPrefix('vardagsmiddag-2026-05-01')).toBe(true);
    expect(hasOldPrefix('vetenskap_kronika-2026-07-14')).toBe(true);
    expect(hasOldPrefix('kvick_essa-2026-03-02')).toBe(true);
    expect(hasOldPrefix('media_recension-2026-07-22')).toBe(true);
    expect(hasOldPrefix('recipe-2026-09-01')).toBe(false);
    expect(hasOldPrefix('meeting-2026-08-27-11040')).toBe(false);
  });
});
