import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THIN_FACILITY_MIN_OWN_WORDS } from './noindex';

describe('thin facility pages (own text under the minimum) are mirrored in the sitemap filter', () => {
  it('astro.config.mjs uses the same minimum as lib/noindex.ts, for every town', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const THIN_FACILITY_MIN_OWN_WORDS = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(THIN_FACILITY_MIN_OWN_WORDS);
    expect(THIN_FACILITY_MIN_OWN_WORDS).toBe(25); // owner B9 2026-11-16
  });
  it('the facility page applies the minimum in every town, not only where a town opts in', () => {
    const page = readFileSync(new URL('../pages/facilities/[slug].astro', import.meta.url), 'utf8');
    expect(page).toContain('const isTextThinFacility = ownWords < THIN_FACILITY_MIN_OWN_WORDS;');
    expect(page).not.toContain('siteConfig.thinFacilityMinOwnWords');
  });
});
