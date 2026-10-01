import { describe, expect, it } from 'vitest';
import { resolveContentSlugRedirect } from './content-slug-redirects';

describe('resolveContentSlugRedirect', () => {
  it('redirects each of the four old Swedish-prefixed slugs to its public path', () => {
    expect(resolveContentSlugRedirect('/s/vardagsmiddag-2026-05-01/')).toBe('/s/recipe-2026-05-01/');
    expect(resolveContentSlugRedirect('/s/vetenskap_kronika-2026-07-14/')).toBe('/s/science-column-2026-07-14/');
    expect(resolveContentSlugRedirect('/s/kvick_essa-2026-03-02/')).toBe('/s/quick-essay-2026-03-02/');
    expect(resolveContentSlugRedirect('/s/media_recension-2026-07-22/')).toBe('/s/review-2026-07-22/');
  });

  it('returns null for a slug that already uses the new public prefix (no redirect loop)', () => {
    expect(resolveContentSlugRedirect('/s/recipe-2026-09-01/')).toBeNull();
    expect(resolveContentSlugRedirect('/s/review-2026-07-22/')).toBeNull();
  });

  it('returns null for every other content type', () => {
    for (const path of [
      '/s/meeting-2026-08-27-11040/', '/s/editorial-2026-09-29/', '/s/culture_essay-2026-08-03/',
      '/s/alert-412/', '/s/weekly-2026-w40/', '/s/workplace-watch-amazon-2026-08/',
    ]) {
      expect(resolveContentSlugRedirect(path)).toBeNull();
    }
  });

  it('returns null for an unrelated, non-/s/ path', () => {
    expect(resolveContentSlugRedirect('/about/')).toBeNull();
    expect(resolveContentSlugRedirect('/')).toBeNull();
  });

  it('preserves everything after the prefix exactly, including a trailing id-like suffix', () => {
    expect(resolveContentSlugRedirect('/s/kvick_essa-2026-03-02-extra/')).toBe('/s/quick-essay-2026-03-02-extra/');
  });
});
