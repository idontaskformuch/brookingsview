/** Neighbourhood per evening row ("Merchant City"). Source: OpenStreetMap place=suburb|neighbourhood|quarter nodes, cut down to a static
 *  file per town by scripts/fetch_city_areas.py (site/src/config/areas/<town>.json, ODbL, credited on the page). A venue gets the
 *  nearest area node within MAX_AREA_KM of its coordinates (Ticketmaster venues carry them), or, for venues without coordinates
 *  (the curated register, own events), the area the script resolved for the venue's name. No area is shown when neither is known. */
import type { EveningEntry } from './evening-items';

export interface AreaNode { name: string; lat: number; lon: number }
export interface AreaData {
  /** Required credit line, shown with the OSM note on the page. */
  attribution: string;
  areas: AreaNode[];
  /** Normalised venue name -> area name, resolved by the script for venues without coordinates in our data. */
  venues: Record<string, string>;
}

export const MAX_AREA_KM = 1.2;

export const normVenue = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function nearestArea(lat: number, lon: number, areas: AreaNode[], maxKm = MAX_AREA_KM): string | null {
  let best: { name: string; d: number } | null = null;
  for (const a of areas) {
    const d = km(lat, lon, a.lat, a.lon);
    if (d <= maxKm && (!best || d < best.d)) best = { name: a.name, d };
  }
  return best?.name ?? null;
}

export function withAreas(entries: EveningEntry[], data: AreaData | null | undefined): EveningEntry[] {
  if (!data) return entries;
  return entries.map((e) => {
    if (e.area) return e;
    const byCoords = e.lat != null && e.lon != null ? nearestArea(e.lat, e.lon, data.areas) : null;
    const area = byCoords ?? (e.venue ? data.venues[normVenue(e.venue)] ?? null : null);
    return area ? { ...e, area } : e;
  });
}

const FILES = import.meta.glob<AreaData>('../config/areas/*.json', { eager: true, import: 'default' });

/** The town's static area file (site/src/config/areas/<town>.json), or null when none has been generated. */
export function areasFor(townId: string): AreaData | null {
  return FILES[`../config/areas/${townId}.json`] ?? null;
}
