import { describe, expect, it } from 'vitest';
import { aboutSourcesFor } from './about-sources';

describe('aboutSourcesFor', () => {
  it('returns a non-empty, real source list for Brookings', () => {
    const sources = aboutSourcesFor('brookings_sd');
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.name).toBeTruthy();
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it('returns a non-empty, real source list for Moreno Valley', () => {
    const sources = aboutSourcesFor('moreno_valley_ca');
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.name).toBeTruthy();
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it('excludes a source that is disabled in config (e.g. traffic for Brookings)', () => {
    const sources = aboutSourcesFor('brookings_sd');
    expect(sources.some((s) => s.name.toLowerCase().includes('caltrans'))).toBe(false);
  });

  it('includes traffic for Moreno Valley, where it is enabled', () => {
    const sources = aboutSourcesFor('moreno_valley_ca');
    expect(sources.some((s) => s.name.toLowerCase().includes('caltrans'))).toBe(true);
  });

  it('never mixes one town\'s sources into the other\'s list', () => {
    const brookings = aboutSourcesFor('brookings_sd');
    const moval = aboutSourcesFor('moreno_valley_ca');
    expect(brookings.some((s) => s.name.includes('eSCRIBE'))).toBe(false);
    expect(moval.some((s) => s.name.includes('Legistar'))).toBe(false);
  });
});
