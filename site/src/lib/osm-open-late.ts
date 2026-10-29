/** "Open late" for the evening layer (step 5, spec .claude/specs/weekend-layer.md T2): pubs, bars, nightclubs and restaurants whose
 *  OpenStreetMap `opening_hours` keep them open past 11 pm on a given evening. Read from Overpass at every build, so the rows follow
 *  the source (freshness rule, spec Skydd punkt 4). Data © OpenStreetMap contributors, ODbL: the page credits and links it.
 *
 *  A failed fetch gives an empty list and a console warning, never a failed build: the block is simply left out. Places whose hours
 *  we cannot read exactly (lib/osm-hours.ts) are left out too. Open-late places are NOT events and never count toward the
 *  indexing threshold. */
import { parseOpeningHours, lateRange, closingLabel, type WeekHours } from './osm-hours';
import { localMidnightIso } from './local-day';

export type OpenLateKind = 'Pub' | 'Bar' | 'Nightclub' | 'Restaurant';

export interface OsmPlace {
  /** `node/123`, `way/456`: links the row back to its OpenStreetMap page. */
  osmId: string;
  name: string;
  kind: OpenLateKind;
  week: WeekHours;
  website: string | null;
}

export interface OpenLateRow {
  osmId: string;
  name: string;
  kind: OpenLateKind;
  closing: string;
  website: string | null;
  /** ISO instants the browser sweep hides the row by: opening time and closing time of the late range. */
  start: string;
  end: string;
}

export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
export const OPEN_LATE_MAX_ROWS = 12;
const KINDS: Record<string, OpenLateKind> = { pub: 'Pub', bar: 'Bar', nightclub: 'Nightclub', restaurant: 'Restaurant' };

interface OverpassElement { type: string; id: number; tags?: Record<string, string> }

export function overpassQuery(lat: number, lon: number, radiusKm: number): string {
  return `[out:json][timeout:25];nwr["amenity"~"^(pub|bar|nightclub|restaurant)$"]["opening_hours"]["name"](around:${Math.round(radiusKm * 1000)},${lat},${lon});out tags;`;
}

function safeWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

/** Overpass elements to places we can read. One row per name and kind: OSM often maps the same pub as a node and a building way. */
export function placesFromOverpass(elements: OverpassElement[]): OsmPlace[] {
  const seen = new Set<string>();
  const out: OsmPlace[] = [];
  for (const el of elements) {
    const t = el.tags;
    if (!t?.name || !t.amenity || !KINDS[t.amenity]) continue;
    const week = parseOpeningHours(t.opening_hours);
    if (!week) continue;
    const key = `${t.name.toLowerCase()}|${t.amenity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ osmId: `${el.type}/${el.id}`, name: t.name, kind: KINDS[t.amenity], week, website: safeWebsite(t.website ?? t['contact:website']) });
  }
  return out;
}

/** Weekday of a day number (days since epoch) as 0 = Monday. 1970-01-01 was a Thursday. */
const weekdayOf = (day: number) => (((day + 3) % 7) + 7) % 7;

const KIND_RANK: Record<OpenLateKind, number> = { Nightclub: 0, Bar: 1, Pub: 2, Restaurant: 3 };

/** Places open past 11 pm on the local calendar `day`, latest closing first (then nightclubs, bars, pubs, restaurants, then name). */
export function openLateRows(places: OsmPlace[], day: number, tz: string, max = OPEN_LATE_MAX_ROWS): OpenLateRow[] {
  const date = new Date(day * 86_400_000);
  const midnight = new Date(localMidnightIso({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }, tz)).getTime();
  const rows: Array<OpenLateRow & { endMin: number }> = [];
  for (const p of places) {
    const r = lateRange(p.week, weekdayOf(day));
    if (!r) continue;
    rows.push({
      osmId: p.osmId, name: p.name, kind: p.kind, closing: closingLabel(r), website: p.website,
      start: new Date(midnight + r.start * 60_000).toISOString(), end: new Date(midnight + r.end * 60_000).toISOString(), endMin: r.end,
    });
  }
  rows.sort((a, b) => b.endMin - a.endMin || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name));
  return rows.slice(0, max).map(({ endMin: _e, ...row }) => row);
}

async function fetchPlaces(lat: number, lon: number, radiusKm: number): Promise<OsmPlace[]> {
  const body = new URLSearchParams({ data: overpassQuery(lat, lon, radiusKm) });
  let lastError = 'no endpoint tried';
  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST', body, headers: { 'User-Agent': 'ViewMediaBot (evening layer build)' }, signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { elements?: OverpassElement[] };
        return placesFromOverpass(json.elements ?? []);
      }
      lastError = `${endpoint} answered ${res.status}`;
    } catch (e) {
      lastError = `${endpoint}: ${e instanceof Error ? e.message : String(e)}`;
    }
    await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
  }
  console.warn(`[evening] open late left out, Overpass unavailable (${lastError})`);
  return [];
}

const _cache = new Map<string, Promise<OsmPlace[]>>();

/** One real fetch per town per build process, shared by /tonight and /this-weekend. */
export function getOsmPlaces(lat: number, lon: number, radiusKm: number): Promise<OsmPlace[]> {
  const key = `${lat},${lon},${radiusKm}`;
  let hit = _cache.get(key);
  if (!hit) { hit = fetchPlaces(lat, lon, radiusKm); _cache.set(key, hit); }
  return hit;
}

export function _resetOsmCacheForTests(): void { _cache.clear(); }
