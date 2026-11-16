/** Traffic Phase 5 (2026-10-09): "In <Town>" / "Approach roads" classification.
 *
 *  Both Moreno Valley's (Caltrans) and Broomfield's (CDOT) scrapers already
 *  geo-filter to a bounding box before storage, but a real stored-data
 *  audit found the box too loose: Moreno Valley was storing SR-38/I-10/
 *  I-210/SR-91 incidents (San Bernardino/Redlands/Riverside-area highways,
 *  not ones that actually serve Moreno Valley) at roughly the same raw
 *  distance as real I-215/SR-60 incidents; Broomfield was storing Denver-
 *  area I-70/I-76/I-270/CO-35 incidents the same way. Distance-from-center
 *  alone can't tell these apart -- a NAMED corridor list
 *  (SiteConfig.trafficCorridors) is the actual fix, same spirit as this
 *  project's existing venue/locality "never guess, use a real signal"
 *  rule.
 *
 *  An incident is shown only if it is (a) inside the real town boundary
 *  ("In <Town>", via town-boundary.ts's pointInBoundary -- the same
 *  polygon /events already uses), or (b) its `road` matches a configured
 *  corridor AND it's within SiteConfig.trafficCorridorMaxMiles of the
 *  boundary (not the center -- see distanceToBoundaryMiles's own doc for
 *  why that distinction matters) ("Approach roads"). Everything else is
 *  dropped, never shown as if it were town-relevant.
 */
import { pointInBoundary, distanceToBoundaryMiles, getTownBoundary } from './town-boundary';
import type { TrafficIncident } from './db';

/** Pulls the bare route number out of a `road` string, regardless of which
 *  source's own format it came from -- Caltrans/traffic_v1.py never
 *  prefixes with "I-"/"SR-" at all ("Southbound 215", "Westbound 60",
 *  "Route 38"), while CDOT/cdot_v1.py's routeName does ("I-25S", "US-36E",
 *  "US-287S"). Matching on the digits alone (ignoring any letter prefix or
 *  trailing direction letter) is enough to be unambiguous against each
 *  town's own real, observed road inventory -- re-verified per town
 *  against live data, not assumed safe in general. Returns null for a
 *  road string with no digits at all (e.g. a bare interchange name). */
export function extractRouteNumber(road: string | null): string | null {
  if (!road) return null;
  const m = road.match(/\d+/);
  return m ? m[0] : null;
}

/** Closure or incident (owner 2026-11-16, audit Fas 6a): the source's own type decides, never the severity keyword match. Only
 *  `lane_closure` is a closure: Caltrans lane closures, and CDOT's own road-work types (Maintenance Operations, Safety Closure; cdot_v1
 *  _is_closure_type). A crash or stalled vehicle is an incident even when its message says a lane is closed (`severity` is 'closure'
 *  for those: the parsers' keyword match, left as it is). Every place that shows the type uses this. */
export type TrafficKind = 'closure' | 'incident';
export function trafficKind(r: { incident_type: string }): TrafficKind {
  return r.incident_type === 'lane_closure' ? 'closure' : 'incident';
}

/** The /traffic/ table's type label: the kind, refined only where the source says more (a planned closure, an injury). */
export type TrafficLabelKey = 'closure' | 'planned' | 'injury' | 'incident';
export const TRAFFIC_LABELS: Record<TrafficLabelKey, string> = {
  closure: 'Closure', planned: 'Planned closure', injury: 'Injury reported', incident: 'Incident',
};
export function trafficLabelKey(r: { incident_type: string; severity: string | null }): TrafficLabelKey {
  if (trafficKind(r) === 'closure') return r.severity === 'planned' ? 'planned' : 'closure';
  return r.severity === 'injury' ? 'injury' : 'incident';
}

export type TrafficZone = 'in_town' | 'approach';

export interface TrafficClassification {
  zone: TrafficZone;
  /** Miles from the town boundary -- null for in_town (home turf, zero by
   *  definition, not worth showing as a number) and for any incident with
   *  no known coordinates. */
  distanceMiles: number | null;
}

/** Classifies one incident, or returns null if it should be dropped
 *  entirely (neither in town nor on a configured corridor within range). */
export function classifyTrafficIncident(
  incident: Pick<TrafficIncident, 'road' | 'lat' | 'lon'>,
  townId: string,
  corridors: { label: string; numbers: string[] }[] | undefined,
  corridorMaxMiles: number | undefined,
): TrafficClassification | null {
  if (incident.lat == null || incident.lon == null) return null;
  const boundary = getTownBoundary(townId);
  if (!boundary) return null;

  if (pointInBoundary(incident.lat, incident.lon, boundary)) {
    return { zone: 'in_town', distanceMiles: null };
  }

  if (!corridors?.length || corridorMaxMiles == null) return null;
  const routeNumber = extractRouteNumber(incident.road);
  if (!routeNumber) return null;
  const onCorridor = corridors.some((c) => c.numbers.includes(routeNumber));
  if (!onCorridor) return null;

  const distanceMiles = distanceToBoundaryMiles(incident.lat, incident.lon, boundary);
  return distanceMiles <= corridorMaxMiles ? { zone: 'approach', distanceMiles } : null;
}
