import { describe, expect, it } from 'vitest';
import {
  pointInBoundary, haversineMiles, classifyLocalityByCoords, classifyLocalityByText,
  getTownBoundary, NEARBY_RADIUS_MILES, distanceToBoundaryMiles,
} from './town-boundary';

describe('getTownBoundary', () => {
  it('has real boundary data for all three towns', () => {
    for (const townId of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co']) {
      const boundary = getTownBoundary(townId);
      expect(boundary).not.toBeNull();
      expect(['Polygon', 'MultiPolygon']).toContain(boundary!.type);
    }
  });

  it('is null for an unknown town', () => {
    expect(getTownBoundary('nope')).toBeNull();
  });
});

describe('pointInBoundary', () => {
  it('Brookings City Hall (real coordinates) falls inside the Brookings, SD boundary', () => {
    const boundary = getTownBoundary('brookings_sd')!;
    expect(pointInBoundary(44.3105, -96.7978, boundary)).toBe(true);
  });

  it('Sioux Falls (a real ~53mi-away city) falls outside the Brookings, SD boundary', () => {
    const boundary = getTownBoundary('brookings_sd')!;
    expect(pointInBoundary(43.5460, -96.7313, boundary)).toBe(false);
  });

  it("the town center falls inside its own boundary, all three towns", () => {
    const centers: Record<string, [number, number]> = {
      brookings_sd: [44.3114, -96.7984],
      moreno_valley_ca: [33.9425, -117.2297],
      broomfield_co: [39.9205, -105.0866],
    };
    for (const [townId, [lat, lon]] of Object.entries(centers)) {
      expect(pointInBoundary(lat, lon, getTownBoundary(townId)!)).toBe(true);
    }
  });

  it('a real Northglenn, CO address (the live BizWest chamber source\'s one event venue, 2026-10-08) falls outside the Broomfield boundary, even though Broomfield is a MultiPolygon', () => {
    const boundary = getTownBoundary('broomfield_co')!;
    expect(boundary.type).toBe('MultiPolygon');
    // Delta Hotels, 10 E 120th Ave, Northglenn CO -- real geocode (Esri
    // World Geocoding Service, verified live during Phase 2 item 2d).
    expect(pointInBoundary(39.9122467, -104.9886432, boundary)).toBe(false);
  });
});

describe('distanceToBoundaryMiles', () => {
  it('is ~0 for a point on the boundary itself (Sioux Falls direction, walked toward Brookings)', () => {
    // Sioux Falls (43.5460, -96.7313) is ~53mi from Brookings' CENTER but
    // the boundary itself is much closer -- this is exactly the
    // center-vs-boundary distinction this function exists for.
    const boundary = getTownBoundary('brookings_sd')!;
    const farPoint = distanceToBoundaryMiles(43.5460, -96.7313, boundary);
    const centerDistance = haversineMiles(43.5460, -96.7313, 44.3114, -96.7984);
    expect(farPoint).toBeLessThan(centerDistance);
    expect(farPoint).toBeGreaterThan(0);
  });

  it('is ~0 for a point exactly on the boundary ring itself', () => {
    const boundary = getTownBoundary('brookings_sd')!;
    const rings = boundary.type === 'Polygon'
      ? (boundary.coordinates as number[][][])
      : (boundary.coordinates as number[][][][])[0];
    const [lon, lat] = rings[0][0];
    expect(distanceToBoundaryMiles(lat, lon, boundary)).toBeLessThan(0.001);
  });

  it('a real nearby-but-outside point (Volga, SD, ~8mi from Brookings) is closer to the boundary than to the center', () => {
    const boundary = getTownBoundary('brookings_sd')!;
    const volga = { lat: 44.3372, lon: -96.9336 };
    const toBoundary = distanceToBoundaryMiles(volga.lat, volga.lon, boundary);
    const toCenter = haversineMiles(volga.lat, volga.lon, 44.3114, -96.7984);
    expect(toBoundary).toBeGreaterThan(0);
    expect(toBoundary).toBeLessThan(toCenter);
  });
});

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles(44.3114, -96.7984, 44.3114, -96.7984)).toBe(0);
  });

  it('matches the documented ~53mi Brookings-to-Sioux-Falls distance (see lib/site-config.ts\'s own ticketmaster radius comment)', () => {
    const miles = haversineMiles(44.3114, -96.7984, 43.5460, -96.7313);
    expect(miles).toBeGreaterThan(48);
    expect(miles).toBeLessThan(58);
  });
});

describe('classifyLocalityByCoords', () => {
  const brookingsCenter = { lat: 44.3114, lon: -96.7984 };

  it('is in_town for a point inside the boundary', () => {
    expect(classifyLocalityByCoords('brookings_sd', 44.3105, -96.7978, brookingsCenter))
      .toEqual({ zone: 'in_town', distanceMiles: null, method: 'coords' });
  });

  it('is nearby, with a distance, for a point outside the boundary but within the radius', () => {
    // ~6mi east of the Brookings boundary, still well under NEARBY_RADIUS_MILES.
    const result = classifyLocalityByCoords('brookings_sd', 44.3114, -96.65, brookingsCenter);
    expect(result.zone).toBe('nearby');
    expect(result.distanceMiles).not.toBeNull();
    expect(result.distanceMiles!).toBeLessThanOrEqual(NEARBY_RADIUS_MILES);
  });

  it('is unknown for a point far outside both the boundary and the radius', () => {
    const result = classifyLocalityByCoords('brookings_sd', 43.5460, -96.7313, brookingsCenter);
    expect(result.zone).toBe('unknown');
    expect(result.distanceMiles!).toBeGreaterThan(NEARBY_RADIUS_MILES);
  });
});

describe('classifyLocalityByText', () => {
  it('is in_town when the text names the town itself', () => {
    expect(classifyLocalityByText('Grand Lodge, 123 Main St, Brookings, SD', 'Brookings'))
      .toEqual({ zone: 'in_town', distanceMiles: null, method: 'text' });
  });

  // Owner correction, 2026-10-08: this used to be 'nearby' with no
  // distance -- an unverifiable claim (NEARBY_RADIUS_MILES can't be
  // checked without a real coordinate). Now 'unknown' (excluded from both
  // sections) -- see classifyLocalityByText()'s own doc comment.
  it('is unknown (never a confident nearby) when the text is address-shaped but names a different place', () => {
    expect(classifyLocalityByText('Delta Hotel, 10 E 120th Ave, Northglenn, CO, 80233', 'Broomfield'))
      .toEqual({ zone: 'unknown', distanceMiles: null, method: 'text' });
  });

  it('is in_town for a bare venue name with no city mentioned at all (benefit of the doubt)', () => {
    expect(classifyLocalityByText('Downtown Main Avenue', 'Brookings'))
      .toEqual({ zone: 'in_town', distanceMiles: null, method: 'text' });
  });
});
