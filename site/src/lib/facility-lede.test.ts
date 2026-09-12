import { describe, expect, it } from 'vitest';
import { buildFacilityLede, pickAddressConnector } from './facility-lede';

describe('buildFacilityLede', () => {
  it('appends the address as a second sentence after the description', () => {
    const lede = buildFacilityLede(
      'A 98,000-square-foot city-operated facility.',
      '280 Spader Way, Broomfield, CO 80020',
      'broomfield-community-center',
    );
    expect(lede).toMatch(/^A 98,000-square-foot city-operated facility\. .+ 280 Spader Way, Broomfield, CO 80020\.$/);
  });

  it('uses one of the known connectors', () => {
    const CONNECTORS = ["It's located at", 'Find it at', "You'll find it at", 'Address:'];
    const lede = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'some-slug');
    expect(CONNECTORS.some((c) => lede!.includes(c))).toBe(true);
  });

  it('is deterministic -- the same slug always picks the same connector', () => {
    const first = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'usps-broomfield');
    const second = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'usps-broomfield');
    expect(first).toBe(second);
  });

  it('varies the connector across different slugs (not one fixed template)', () => {
    // Real facility slugs from data/facilities/broomfield_co.json -- confirms
    // this doesn't collapse to the same connector for every real page.
    const slugs = [
      'broomfield-community-center', 'broomfield-police-department', 'library',
      'city-hall', 'county-commons-park', 'north-metro-fire-headquarters',
      'north-metro-fire-station-61', 'usps-broomfield', 'usps-broomfield-eagle-view',
    ];
    const connectors = new Set(slugs.map((s) => pickAddressConnector(s)));
    expect(connectors.size).toBeGreaterThan(1);
  });

  it('falls back to the address alone when there is no description', () => {
    const lede = buildFacilityLede(null, '123 Main St, Anytown, ST 00000', 'some-slug');
    expect(lede).not.toBeNull();
    expect(lede).toMatch(/123 Main St, Anytown, ST 00000\.$/);
  });

  it('falls back to the description alone when there is no address', () => {
    const lede = buildFacilityLede('Just a description.', null, 'some-slug');
    expect(lede).toBe('Just a description.');
  });

  it('returns null when neither description nor address exists', () => {
    expect(buildFacilityLede(null, null, 'some-slug')).toBeNull();
  });
});

describe('pickAddressConnector', () => {
  it('is a pure function of the slug alone', () => {
    expect(pickAddressConnector('city-hall')).toBe(pickAddressConnector('city-hall'));
  });
});
