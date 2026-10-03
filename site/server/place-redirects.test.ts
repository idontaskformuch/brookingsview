import { describe, expect, it } from 'vitest';
import { resolvePlaceRedirect } from './place-redirects';

describe('resolvePlaceRedirect', () => {
  it('redirects a /place/[slug] URL to the equivalent /facilities/[slug] URL', () => {
    expect(resolvePlaceRedirect('/place/north-metro-fire-headquarters/')).toBe('/facilities/north-metro-fire-headquarters/');
  });

  it('redirects a /place/[slug] URL with no trailing slash too', () => {
    expect(resolvePlaceRedirect('/place/north-metro-fire-headquarters')).toBe('/facilities/north-metro-fire-headquarters/');
  });

  it('redirects /places/ (with and without the trailing slash) to /facilities/', () => {
    expect(resolvePlaceRedirect('/places/')).toBe('/facilities/');
    expect(resolvePlaceRedirect('/places')).toBe('/facilities/');
  });

  it('returns null for an already-/facilities/ path (no redirect loop)', () => {
    expect(resolvePlaceRedirect('/facilities/north-metro-fire-headquarters/')).toBeNull();
    expect(resolvePlaceRedirect('/facilities/')).toBeNull();
  });

  it('returns null for an unrelated path', () => {
    expect(resolvePlaceRedirect('/about/')).toBeNull();
    expect(resolvePlaceRedirect('/')).toBeNull();
    expect(resolvePlaceRedirect('/placeholder/')).toBeNull();
  });
});
