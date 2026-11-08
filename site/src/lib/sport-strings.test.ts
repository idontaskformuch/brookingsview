import { describe, expect, it } from 'vitest';
import { sportTerms } from './sport-strings';

describe('sport strings', () => {
  it('both countries have the same keys', () => {
    expect(Object.keys(sportTerms('gb')).sort()).toEqual(Object.keys(sportTerms('us')).sort());
  });
  it('says "In progress", never "Live" (we have no live data)', () => {
    for (const c of ['us', 'gb']) {
      expect(sportTerms(c).in_progress).toBe('In progress');
      expect(JSON.stringify(sportTerms(c))).not.toMatch(/\blive\b/i);
    }
  });
  it('spells canceled per country', () => {
    expect(sportTerms('us').cancelled).toBe('Canceled');
    expect(sportTerms('gb').cancelled).toBe('Cancelled');
  });
});
