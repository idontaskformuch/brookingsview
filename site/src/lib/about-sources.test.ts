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

  // 2026-10-01 cleanup round, item 2: Ticketmaster is gated under
  // features.whats_on.ticketmaster.enabled, not data_sources[key].enabled --
  // a different shape than every other curated row. Locks in that the
  // special-cased lookup in isEnabled() actually works, for all three towns
  // (all three have it enabled as of this writing).
  it('includes Ticketmaster for every town (gated on features.whats_on.ticketmaster)', () => {
    for (const townId of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co']) {
      const sources = aboutSourcesFor(townId);
      expect(sources.some((s) => s.name.includes('Ticketmaster'))).toBe(true);
    }
  });

  it('includes Brookings\' Chamber of Commerce / GrowthZone events source', () => {
    const sources = aboutSourcesFor('brookings_sd');
    expect(sources.some((s) => s.name.includes('GrowthZone'))).toBe(true);
  });

  it('includes Broomfield\'s Vail Resorts regional news source', () => {
    const sources = aboutSourcesFor('broomfield_co');
    expect(sources.some((s) => s.name.includes('Vail Resorts'))).toBe(true);
  });
});
