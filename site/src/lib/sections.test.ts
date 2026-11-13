import { describe, expect, it } from 'vitest';
import { isSectionBuilt, linksToBuiltSection, sportsHref } from './sections';
import { enabledSections } from './nav-sections';
import { ROUTE_AVAILABILITY } from '../config/clusters';
import { ALL_CONFIGS } from './site-config';

const town = (id: string) => ALL_CONFIGS.find((c) => c.townId === id)!;

// The redirect stubs QA build.internal-links found on 2026-11-13 (F18): Glasgow's footer /advertising/ and /jobs/,
// Broomfield's /vail-resorts/ -> /reviews/ and its weeks -> /sports/.
describe('isSectionBuilt: one rule for a section page and every link to it (F18 2026-11-13)', () => {
  it('Glasgow builds neither /advertising/ nor /jobs/', () => {
    expect(isSectionBuilt('advertising', town('glasgow'))).toBe(false);
    expect(isSectionBuilt('jobs', town('glasgow'))).toBe(false);
    expect(linksToBuiltSection('/jobs/', town('glasgow'))).toBe(false);
  });
  it('Broomfield builds no /reviews/ and no sports page', () => {
    expect(isSectionBuilt('reviews', town('broomfield_co'))).toBe(false);
    expect(sportsHref(town('broomfield_co'))).toBeNull();
  });
  it('the sports page is each town’s own', () => {
    expect(sportsHref(town('brookings_sd'))).toBe('/jackrabbits/');
    expect(sportsHref(town('moreno_valley_ca'))).toBe('/sports/');
    expect(sportsHref(town('glasgow'))).toBeNull();
  });
  it('a link that is not a section page is never dropped', () => {
    expect(linksToBuiltSection('/city-hall/', town('glasgow'))).toBe(true);
  });
  it('menu, footer and cluster links ask the same rule in every town', () => {
    for (const c of ALL_CONFIGS) {
      const navHrefs = new Set(enabledSections(c).map((s) => s.href));
      for (const id of ['jobs', 'weather', 'facilities', 'traffic', 'jackrabbits', 'sports', 'vail-resorts'] as const) {
        if (!isSectionBuilt(id, c)) expect(navHrefs.has(`/${id}/`), `${c.townId} nav ${id}`).toBe(false);
        expect(ROUTE_AVAILABILITY[id](c), `${c.townId} cluster ${id}`).toBe(isSectionBuilt(id, c));
      }
      expect(ROUTE_AVAILABILITY.reviews(c)).toBe(isSectionBuilt('reviews', c));
    }
  });
});
