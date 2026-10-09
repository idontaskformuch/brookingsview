import { describe, expect, it } from 'vitest';
import { resolveFacilityRedirect } from './_shared';
import facilityRedirects from './facility-redirects.json';

// Real live example (Phase 2, item 2f): "Moreno Valley Conference and
// Recreation Center" and "Conference & Recreation Center" were two
// separate `places` rows (both GIS-import, same real building, different
// source names) -- merged into the latter slug.
const MAP = { 'moreno-valley-conference-and-recreation-center': 'conference-recreation-center' };

describe('resolveFacilityRedirect', () => {
  it('redirects a merged-away facility slug to its canonical /facilities/ path', () => {
    expect(resolveFacilityRedirect('/facilities/moreno-valley-conference-and-recreation-center/', MAP))
      .toBe('/facilities/conference-recreation-center/');
  });

  it('returns null for a slug not in the map', () => {
    expect(resolveFacilityRedirect('/facilities/main-library/', MAP)).toBeNull();
  });

  it('returns null for an unrelated path', () => {
    expect(resolveFacilityRedirect('/about/', MAP)).toBeNull();
    expect(resolveFacilityRedirect('/', MAP)).toBeNull();
  });

  it('never matches a slug that is already canonical', () => {
    expect(resolveFacilityRedirect('/facilities/conference-recreation-center/', MAP)).toBeNull();
  });

  it('works with an empty map', () => {
    expect(resolveFacilityRedirect('/facilities/moreno-valley-conference-and-recreation-center/', {})).toBeNull();
  });

  it('the real facility-redirects.json loads and resolves the live merge', () => {
    const path = resolveFacilityRedirect(
      '/facilities/moreno-valley-conference-and-recreation-center/',
      facilityRedirects as Record<string, string>,
    );
    expect(path).toBe('/facilities/conference-recreation-center/');
  });
});
