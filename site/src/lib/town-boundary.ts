/**
 * Phase 2, item 2a: shared point-in-polygon / distance utility for the new
 * /events "In <Town>" vs "Nearby" split -- built as a standalone module
 * (not folded into lib/events.ts) specifically so it's reusable later for
 * Traffic and Jobs, per the phase2-spec's own instruction.
 *
 * Boundary data: each town's own Census Bureau cartographic boundary
 * ("Incorporated Places 500K", generalized -- plenty precise for a
 * point-in-polygon test, far smaller than the full-resolution TIGER/Line
 * geometry) -- fetched 2026-10-08 from TIGERweb's public ArcGIS REST
 * service (Generalized_ACS2023/Places_CouSub_ConCity_SubMCD/MapServer/10),
 * queried by each town's own Census GEOID, returned in WGS84 (outSR=4326)
 * to match the lat/lon already stored on `places`/`facilities` rows (see
 * data/facilities/*.json's own lat/lon, geocoded via the same free Esri
 * service). Broomfield is a consolidated city-county, so its "place"
 * boundary is genuinely the whole county -- confirmed its GEOID (0809280)
 * resolves under Incorporated Places, not a separate county layer, and its
 * polygon's bbox matches configs/broomfield_co.json's own town-center
 * coordinates. No live API call at request time -- these are static,
 * checked-in snapshots; a town's boundary doesn't change.
 */
import brookingsGeometry from '../data/town-boundaries/brookings_sd.json';
import morenoValleyGeometry from '../data/town-boundaries/moreno_valley_ca.json';
import broomfieldGeometry from '../data/town-boundaries/broomfield_co.json';

export interface BoundaryGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

const TOWN_BOUNDARIES: Record<string, BoundaryGeometry> = {
  brookings_sd: brookingsGeometry as BoundaryGeometry,
  moreno_valley_ca: morenoValleyGeometry as BoundaryGeometry,
  broomfield_co: broomfieldGeometry as BoundaryGeometry,
};

export function getTownBoundary(townId: string): BoundaryGeometry | null {
  return TOWN_BOUNDARIES[townId] ?? null;
}

/** Standard ray-casting point-in-ring test (even-odd rule). `ring` is a
 *  GeoJSON linear ring: [lon, lat] pairs, first === last. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** rings[0] is the exterior ring, rings[1..] are holes (GeoJSON Polygon
 *  convention) -- inside the exterior AND not inside any hole. */
function pointInPolygon(lon: number, lat: number, rings: number[][][]): boolean {
  if (!pointInRing(lon, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(lon, lat, hole));
}

/** `geometry.coordinates` is `Polygon[rings]` or `MultiPolygon[poly][rings]` --
 *  true if the point falls in ANY part (Broomfield's own boundary is a real
 *  MultiPolygon, confirmed live 2026-10-08: two parts, re-verified against
 *  its own town-center coordinates and against a real geocoded address
 *  (the BizWest chamber source's one live event, Northglenn CO) that must
 *  correctly resolve OUTSIDE -- see site/src/lib/town-boundary.test.ts). */
export function pointInBoundary(lat: number, lon: number, geometry: BoundaryGeometry): boolean {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : (geometry.coordinates as number[][][][]);
  return polygons.some((rings) => pointInPolygon(lon, lat, rings));
}

const EARTH_RADIUS_MILES = 3958.8;

/** Straight-line (great-circle) distance, not real road/drive distance --
 *  a deliberate choice (owner decision, 2026-10-08): the site's own
 *  /whats-on/ page already made and documented this exact tradeoff
 *  (lib/ticketmaster.ts's IN_TOWN_THRESHOLD_MILES comment: "a routing API
 *  for real drive-time is a real recurring cost not worth paying"). UI
 *  copy for this feature must say "N mi away," never a time estimate --
 *  converting miles to a fabricated minutes figure would imply real-road
 *  routing accuracy this number doesn't have. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Phase 2 spec default: events farther than this from the town center
 *  (and outside the town boundary) don't count as "nearby" at all -- they
 *  just don't appear in either geo section. In practice this almost never
 *  excludes anything: every event source is itself a town-scoped or
 *  immediately-adjacent calendar (see the venue-name-dropping precedent
 *  already accepted for other ICS sources). */
export const NEARBY_RADIUS_MILES = 25;

export type LocalityZone = 'in_town' | 'nearby' | 'unknown';

/** How a LocalityResult was reached -- purely diagnostic (see events.astro's
 *  own per-build `[locality]` count log, added alongside the fix below) so a
 *  human can see how much of "nearby" rests on a real measured distance
 *  versus a guess, per town, per build. */
export type LocalityMethod = 'coords' | 'text' | 'default';

export interface LocalityResult {
  zone: LocalityZone;
  /** Miles from the town center -- only ever set when a REAL coordinate
   *  distance was computed (method `'coords'`). `null` for `in_town` (home
   *  turf by definition), for `unknown`'s text-fallback cases, and for every
   *  `'text'`-method result -- see classifyLocalityByText()'s own doc for
   *  why a text match is never allowed to assert a distance it can't back
   *  up with a real coordinate. */
  distanceMiles: number | null;
  method: LocalityMethod;
}

/** Coordinate-based classification: in the town's own Census boundary, or
 *  within NEARBY_RADIUS_MILES of its center, or neither. Call sites that
 *  only have a free-text venue string (no resolved facility) use
 *  classifyLocalityByText() below instead. */
export function classifyLocalityByCoords(
  townId: string, lat: number, lon: number, townCenter: { lat: number; lon: number },
): LocalityResult {
  const boundary = getTownBoundary(townId);
  if (boundary && pointInBoundary(lat, lon, boundary)) return { zone: 'in_town', distanceMiles: null, method: 'coords' };
  const distanceMiles = haversineMiles(lat, lon, townCenter.lat, townCenter.lon);
  if (distanceMiles <= NEARBY_RADIUS_MILES) return { zone: 'nearby', distanceMiles, method: 'coords' };
  return { zone: 'unknown', distanceMiles, method: 'coords' };
}

/** Fallback for a venue that didn't resolve to a known `facilities`/`places`
 *  row (so no coordinates exist at all) -- per the phase2-spec's own
 *  instruction ("fallback: venue address city"). Purely textual, and
 *  necessarily weaker than the coordinate path.
 *
 *  Owner correction, 2026-10-08 (post-2a verification round): this
 *  USED TO return `nearby` for any address-shaped text that named a
 *  different real place, with no distance -- an unbounded claim, since
 *  NEARBY_RADIUS_MILES (the one real cap this whole feature is supposed to
 *  enforce) can't be checked without a real coordinate. A manual spot-check
 *  (Moreno Valley's Farm House Collective, geocoded by hand) happened to
 *  confirm ~6.8mi, genuinely within radius -- but that was luck, not a
 *  property of the check itself: this same branch would have said "nearby"
 *  just as confidently for a venue 200 miles away. Per this project's own
 *  "zero events is better than wrong events" rule, an unverifiable match
 *  must never be labeled `nearby` -- it's `unknown` (excluded from both
 *  sections) instead. A venue worth actually showing as Nearby needs a real
 *  `places` row with real geocoded coordinates (see venue_registry.py /
 *  lib/db.ts's resolveVenue()), which routes it through
 *  classifyLocalityByCoords() above instead of this function entirely.
 *
 *  `in_town` is NOT weakened the same way: naming the town itself is a
 *  real positive signal, not a distance claim, and a bare venue name with
 *  no city at all (e.g. "City Hall") gets the benefit of the doubt for the
 *  same reason it already did -- neither asserts a specific distance. */
export function classifyLocalityByText(venueText: string, cityName: string): LocalityResult {
  const normalized = venueText.toLowerCase();
  if (normalized.includes(cityName.toLowerCase())) return { zone: 'in_town', distanceMiles: null, method: 'text' };
  // A real street address names SOME city -- "<street>, <city>, <ST>" -- so
  // a comma-separated string with 2+ parts that doesn't mention our own
  // town is read as a different, real place -- `unknown`, not `nearby` (see
  // doc comment above for why this can no longer assert "nearby" here).
  const looksLikeAddress = venueText.split(',').length >= 2;
  return looksLikeAddress
    ? { zone: 'unknown', distanceMiles: null, method: 'text' }
    : { zone: 'in_town', distanceMiles: null, method: 'text' };
}
