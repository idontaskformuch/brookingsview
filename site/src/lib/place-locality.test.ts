import { describe, expect, it } from 'vitest';
import { addressCity, otherTownOf } from './place-locality';

// Real places rows (places.address, 2026-11-26).
const FARM_HOUSE = { address: '1393 University Ave, Riverside, CA 92507' }; // moreno_valley_ca/farm-house-collective
const ANIMAL_SHELTER = { address: '14041 Elsworth St, Moreno Valley, CA 92553' }; // moreno_valley_ca/animal-shelter
const COLLEGE_PARK = { address: '16130 Lasselle Street, Moreno Valley, CA' }; // moreno_valley_ca/college-park (no ZIP)
const ARROWHEAD = { address: 'Brookings, SD 57006' }; // brookings_sd/arrowhead-park (town only)
const GOMA = { address: 'Royal Exchange Square, Glasgow G1 3AH' }; // glasgow/gallery-of-modern-art-goma

describe('addressCity', () => {
  it('reads the town from US and UK addresses', () => {
    expect(addressCity(FARM_HOUSE.address)).toBe('Riverside');
    expect(addressCity(ANIMAL_SHELTER.address)).toBe('Moreno Valley');
    expect(addressCity(COLLEGE_PARK.address)).toBe('Moreno Valley');
    expect(addressCity(ARROWHEAD.address)).toBe('Brookings');
    expect(addressCity(GOMA.address)).toBe('Glasgow');
    expect(addressCity(null)).toBeNull();
    expect(addressCity('Kings Drive')).toBeNull();
  });
});

describe('otherTownOf', () => {
  it('names the other town for Farm House Collective on the Moreno Valley site, and nothing for a Moreno Valley address', () => {
    expect(otherTownOf(FARM_HOUSE, 'Moreno Valley')).toBe('Riverside');
    expect(otherTownOf(ANIMAL_SHELTER, 'Moreno Valley')).toBeNull();
    expect(otherTownOf(COLLEGE_PARK, 'moreno valley')).toBeNull();
    expect(otherTownOf(GOMA, 'Glasgow')).toBeNull();
    expect(otherTownOf({ address: null }, 'Glasgow')).toBeNull();
  });
});

describe('event venue strings and the week page', () => {
  // Real events.venue (events 332486 "Jazz Night", source farm_house_collective).
  const VENUE = 'Farm House Collective, 1393 University Ave, Riverside, CA, 92507, United States';
  it('reads the town from an event feed venue with ", CA, 92507, United States"', () => {
    expect(addressCity(VENUE)).toBe('Riverside');
  });
  it('the week page keeps the other town on the row', async () => {
    const { shortVenue } = await import('./week-groups');
    expect(shortVenue(VENUE, 'Moreno Valley')).toBe('Farm House Collective · Nearby, Riverside');
    expect(shortVenue('14041 Elsworth St, Moreno Valley, CA 92553', 'Moreno Valley')).toBe('14041 Elsworth St');
    expect(shortVenue(VENUE)).toBe('Farm House Collective');
  });
});

describe('evening rows (/tonight, /this-weekend, front page)', () => {
  it('an evening entry at a venue in another town is marked "Nearby · <town>", a home-town one keeps its area', async () => {
    const { withAreas } = await import('./areas');
    // Real events.venue rows: farm_house_collective (events 332486) and the Moreno Valley animal shelter's address (places).
    const rows = [
      { venue: 'Farm House Collective, 1393 University Ave, Riverside, CA, 92507, United States', area: null },
      { venue: '14041 Elsworth St, Moreno Valley, CA 92553', area: 'Sunnymead' },
    ] as unknown as Parameters<typeof withAreas>[0];
    const out = withAreas(rows, null, 'Moreno Valley');
    expect(out.map((e) => e.area)).toEqual(['Nearby · Riverside', 'Sunnymead']);
    expect(withAreas(rows, null).map((e) => e.area)).toEqual([null, 'Sunnymead']);
  });
});

describe('event rows on /today', () => {
  it('a row whose venue is in another town says "Nearby · <town>" after the venue', async () => {
    const { rowFromFeedItem, rowEnvFor } = await import('./event-row');
    // Real event: events 332486 "Jazz Night" at Farm House Collective (venue_raw as stored).
    const item = { sourceKind: 'story', occurs_at: '2026-12-01T02:00:00Z', story: {
      title: 'Jazz Night', slug: 'jazz-night', body: '', occurs_at: '2026-12-01T02:00:00Z', ends_at: null, source_url: null,
      venue_raw: 'Farm House Collective, 1393 University Ave, Riverside, CA, 92507, United States', meta: null,
    } } as never;
    const env = rowEnvFor({ timezone: 'America/Los_Angeles', cityName: 'Moreno Valley' }, new Date('2026-11-30T12:00:00Z'));
    const facts = () => ({ title: 'Jazz Night', venue: 'Farm House Collective', area: 'Nearby · Riverside', elsewhere: 'Riverside', free: false, kids: false });
    expect(rowFromFeedItem(item, env, facts).place).toEqual(['Farm House Collective', 'Nearby · Riverside']);
    expect(rowFromFeedItem(item, env, () => ({ ...facts(), elsewhere: null })).place).toEqual(['Farm House Collective']);
  });
});
