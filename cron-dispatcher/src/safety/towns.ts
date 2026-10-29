/** Who gets fire and air-quality notices. Mirrors configs/<town>.json `coordinates` (test/safety.test.ts fails when they drift apart).
 *  Owner 2026-10-29: 25 miles for both. Brookings (NWS alerts are enough) and Glasgow (Police Scotland / SFRS, a later step) have none. */
export interface SafetyTown { townId: string; lat: number; lon: number; radiusMiles: number; fireMaxAgeDays: number }

export const SAFETY_TOWNS: SafetyTown[] = [
  { townId: 'moreno_valley_ca', lat: 33.9425, lon: -117.2297, radiusMiles: 25, fireMaxAgeDays: 3 },
  { townId: 'broomfield_co', lat: 39.9205, lon: -105.0866, radiusMiles: 25, fireMaxAgeDays: 3 },
];

export function distanceMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
