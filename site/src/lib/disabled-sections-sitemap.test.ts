import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';

const PAGE: Record<string, string> = {
  traffic: '/traffic/', jobs: '/jobs/', advertising: '/advertising/', reviews: '/reviews/', recipes: '/recipes/', editorials: '/editorials/', columns: '/columns/',
};

describe('sections a town has switched off stay out of its sitemap (found 2026-10-28: /advertising/ and /traffic/ were listed but noindex)', () => {
  it("the mirror in astro.config.mjs lists the pages of Glasgow's disabledSections", () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const DISABLED_PAGES = (\{[^}]*\});/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as Record<string, string[]>;
    const glasgow = ALL_CONFIGS.find((c) => c.townId === 'glasgow')!;
    const expected = (glasgow.disabledSections ?? []).map((id) => PAGE[id]).filter(Boolean).sort();
    expect((mirror.glasgow ?? []).slice().sort()).toEqual(expected);
  });
});
