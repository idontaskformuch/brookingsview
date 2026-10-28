import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';

describe('thin facility pages (own text under the town minimum) are mirrored in the sitemap filter', () => {
  it('astro.config.mjs lists exactly the towns that set thinFacilityMinOwnWords, with the same number', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const THIN_FACILITY_MIN_OWN_WORDS = (\{[^}]*\});/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as Record<string, number>;
    for (const c of ALL_CONFIGS) expect(mirror[c.townId]).toBe(c.thinFacilityMinOwnWords);
  });
});
