import { describe, expect, it } from 'vitest';
import { extractRouteNumber, classifyTrafficIncident } from './traffic';

describe('extractRouteNumber', () => {
  // Real values pulled live from traffic_incidents.road, both sources.
  it('parses Caltrans-style directional format (traffic_v1.py, no letter prefix)', () => {
    expect(extractRouteNumber('Southbound 215')).toBe('215');
    expect(extractRouteNumber('Westbound 60')).toBe('60');
    expect(extractRouteNumber('Eastbound 10')).toBe('10');
    expect(extractRouteNumber('Route 38')).toBe('38');
  });

  it('parses CDOT-style route+direction-suffix format (cdot_v1.py routeName)', () => {
    expect(extractRouteNumber('I-25S')).toBe('25');
    expect(extractRouteNumber('I-70E')).toBe('70');
    expect(extractRouteNumber('US-36E')).toBe('36');
    expect(extractRouteNumber('US-287S')).toBe('287');
    expect(extractRouteNumber('CO-35S')).toBe('35');
  });

  it('takes the first route number out of a multi-route interchange label', () => {
    expect(extractRouteNumber('(G) - I-25 | WASHINGTON ST |  I-70 EAST | I-70 WEST')).toBe('25');
  });

  it('is null for a road string with no digits at all, and for null', () => {
    expect(extractRouteNumber('Main St')).toBeNull();
    expect(extractRouteNumber(null)).toBeNull();
  });
});

describe('classifyTrafficIncident', () => {
  const MV_CORRIDORS = [{ label: 'I-215', numbers: ['215'] }, { label: 'SR-60', numbers: ['60'] }];

  it('is in_town for a point inside the boundary, regardless of road', () => {
    const result = classifyTrafficIncident(
      { road: null, lat: 33.9425, lon: -117.2297 }, 'moreno_valley_ca', MV_CORRIDORS, 10,
    );
    expect(result).toEqual({ zone: 'in_town', distanceMiles: null });
  });

  it('is approach for a real I-215 incident outside town but within range', () => {
    // Real stored sample: "Southbound 215", 33.931366, -117.352266 (~7mi from center).
    const result = classifyTrafficIncident(
      { road: 'Southbound 215', lat: 33.931366, lon: -117.352266 }, 'moreno_valley_ca', MV_CORRIDORS, 10,
    );
    expect(result?.zone).toBe('approach');
    expect(result?.distanceMiles).not.toBeNull();
  });

  it('drops a real SR-38 incident (not a configured Moreno Valley corridor) even though it is a similar raw distance', () => {
    // Real stored sample: "Route 38", 34.061805, -117.182529.
    const result = classifyTrafficIncident(
      { road: 'Route 38', lat: 34.061805, lon: -117.182529 }, 'moreno_valley_ca', MV_CORRIDORS, 10,
    );
    expect(result).toBeNull();
  });

  it('drops a real corridor-road incident that is outside the configured max distance', () => {
    const result = classifyTrafficIncident(
      { road: 'Southbound 215', lat: 33.931366, lon: -117.352266 }, 'moreno_valley_ca', MV_CORRIDORS, 0.001,
    );
    expect(result).toBeNull();
  });

  it('drops an incident with no coordinates', () => {
    const result = classifyTrafficIncident(
      { road: 'Southbound 215', lat: null, lon: null }, 'moreno_valley_ca', MV_CORRIDORS, 10,
    );
    expect(result).toBeNull();
  });

  it('drops everything for a town with no configured corridors (Brookings today)', () => {
    const result = classifyTrafficIncident(
      { road: 'US-14', lat: 44.40, lon: -96.80 }, 'brookings_sd', undefined, undefined,
    );
    expect(result).toBeNull();
  });
});
