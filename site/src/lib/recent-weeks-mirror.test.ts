import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';

// Regression (Broomfield audit 2026-11-04): the page said noindex for a passed week while the sitemap mirror in astro.config.mjs still listed it,
// which scripts/verify_sitemap_noindex_disjoint.mjs caught. The two must agree on the number of indexable weeks per town.
describe('recent weeks indexed is mirrored in the sitemap filter', () => {
  it('astro.config.mjs overrides exactly the towns that set recentWeeksIndexed, with the same number', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const RECENT_WEEKS_OVERRIDE = (\{[^}]*\});/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as Record<string, number>;
    for (const c of ALL_CONFIGS) expect(mirror[c.townId]).toBe(c.recentWeeksIndexed);
  });
});
