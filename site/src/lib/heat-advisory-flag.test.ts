import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('hasHeatAdvisory flag', () => {
  const src = readFileSync(new URL('./site-config.ts', import.meta.url), 'utf-8');
  it('is enabled for exactly one town: Moreno Valley', () => {
    const enabled = [...src.matchAll(/hasHeatAdvisory:\s*true,/g)];
    expect(enabled).toHaveLength(1);
    const before = src.slice(0, enabled[0].index!);
    // Town blocks start with ...TOWN_REGISTRY.<id> (audit Fas 3a).
    expect(before.lastIndexOf('...TOWN_REGISTRY.moreno_valley_ca')).toBeGreaterThan(before.lastIndexOf('...TOWN_REGISTRY.brookings_sd'));
    expect(before.lastIndexOf('...TOWN_REGISTRY.moreno_valley_ca')).toBeGreaterThan(before.lastIndexOf('...TOWN_REGISTRY.broomfield_co'));
  });
});
