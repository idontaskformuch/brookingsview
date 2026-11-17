// Audit Fas 3a: town-registry.mjs mirrors configs/<town>.json (which Python reads) for every field both have.
// siteName and noindexSite exist only in the registry (source: town-registry.mjs).
import { describe, expect, it } from 'vitest';
import { TOWN_REGISTRY } from './town-registry.mjs';
import { ALL_CONFIGS } from './site-config';
import brookingsConfig from '../../../configs/brookings_sd.json';
import morenoValleyConfig from '../../../configs/moreno_valley_ca.json';
import broomfieldConfig from '../../../configs/broomfield_co.json';
import glasgowConfig from '../../../configs/glasgow.json';

const JSON_CONFIGS: Record<string, any> = {
  brookings_sd: brookingsConfig,
  moreno_valley_ca: morenoValleyConfig,
  broomfield_co: broomfieldConfig,
  glasgow: glasgowConfig,
};

describe('town registry vs configs/*.json', () => {
  it('has the same towns as configs/', () => {
    expect(Object.keys(TOWN_REGISTRY).sort()).toEqual(Object.keys(JSON_CONFIGS).sort());
  });

  for (const [id, json] of Object.entries(JSON_CONFIGS)) {
    it(`${id}: every shared field agrees`, () => {
      const t = TOWN_REGISTRY[id];
      expect(t.townId).toBe(json.town_id);
      expect(t.cityName).toBe(json.display_name);
      expect(t.timezone).toBe(json.timezone);
      expect(t.country).toBe(json.country);
      expect(t.nation).toBe(json.nation);
      expect(t.domain).toBe(json.domain);
      expect(t.siteUrl).toBe(`https://${json.domain}`);
    });
  }

  it('site-config carries the registry identity unchanged', () => {
    for (const c of ALL_CONFIGS) {
      const t = TOWN_REGISTRY[c.townId];
      for (const k of Object.keys(t) as (keyof typeof t)[]) expect(c[k], `${c.townId}.${k}`).toBe(t[k]);
    }
  });
});
