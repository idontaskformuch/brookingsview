import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { enabledSections } from './nav-sections';

const PAGE: Record<string, string> = { traffic: '/traffic/', events: '/events/', workplace: '/workplace-watch/' };

describe('quiet sections (reachable, noindex, out of the nav and the sitemap)', () => {
  it('the sitemap mirror in astro.config.mjs lists exactly the towns quiet sections', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const QUIET_PAGES = (\{[^}]*\});/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as Record<string, string[]>;
    for (const c of ALL_CONFIGS) {
      const expected = (c.quietSections ?? []).map((id) => PAGE[id]).sort();
      expect((mirror[c.townId] ?? []).slice().sort()).toEqual(expected);
    }
  });
  it('a quiet section is not in the nav or the footer', () => {
    for (const c of ALL_CONFIGS) {
      const ids = enabledSections(c).map((s) => s.id);
      for (const q of c.quietSections ?? []) expect(ids).not.toContain(q);
    }
  });
  it('the three pages the owner named are quiet today', () => {
    const by = Object.fromEntries(ALL_CONFIGS.map((c) => [c.townId, c.quietSections ?? []]));
    expect(by.brookings_sd).toContain('traffic');
    expect(by.broomfield_co).toEqual(expect.arrayContaining(['events', 'workplace']));
  });
});
