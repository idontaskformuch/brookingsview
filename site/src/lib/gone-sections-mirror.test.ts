import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { GONE_SECTIONS_BY_TOWN } from '../../server/_shared';

const GONE_IDS = ['recipes', 'reviews', 'columns', 'editorials'];

describe('Worker 410 list mirrors disabledSections', () => {
  for (const cfg of ALL_CONFIGS) {
    it(`${cfg.townId}: the retired content-track sections match`, () => {
      const expected = (cfg.disabledSections ?? []).filter((id) => GONE_IDS.includes(id)).map((id) => `/${id}/`).sort();
      expect((GONE_SECTIONS_BY_TOWN[cfg.townId] ?? []).slice().sort()).toEqual(expected);
    });
  }
});
