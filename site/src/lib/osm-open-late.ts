/** "Open late" for the evening layer (step 5, spec .claude/specs/weekend-layer.md T2): pubs, bars, nightclubs and restaurants whose
 *  OpenStreetMap `opening_hours` keep them open past 11 pm on a given evening. Read from the weekly snapshot in osm_places
 *  (scripts/refresh_osm_places.py): builds never call Overpass. No snapshot, or one older than 14 days, means no block (freshness rule,
 *  spec Skydd punkt 4). Data © OpenStreetMap contributors, ODbL: the page credits and links it.
 *
 *  Places whose hours we cannot read exactly (lib/osm-hours.ts) are left out. Open-late places are NOT events and never count toward the
 *  indexing threshold. */
import { parseOpeningHoursLoose, lateRange, closingLabel, type WeekHours } from './osm-hours';
import { localMidnightIso } from './local-day';
import { canonicalVenue } from './evening-names';
import { normVenue, type AreaData } from './areas';

/** Cafe is in the snapshot for the daytime "open now" list on /today (lib/open-tonight.ts); it never joins Open late or Open tonight. */
export type OpenLateKind = 'Pub' | 'Bar' | 'Nightclub' | 'Restaurant' | 'Cafe';

export interface OsmPlace {
  /** `node/123`, `way/456`: links the row back to its OpenStreetMap page. */
  osmId: string;
  name: string;
  kind: OpenLateKind;
  week: WeekHours;
  website: string | null;
  /** From the snapshot's `center` (or `lat`/`lon` on a node); null in snapshots written before the refresh asked for coordinates. */
  lat: number | null;
  lon: number | null;
  /** OSM `check_date` tag (YYYY-MM-DD, the mapper's own "I checked this") and the element's last edit in OSM (`out meta` timestamp); null when the snapshot predates them. */
  checkDate: string | null;
  editedAt: string | null;
  /** The hours string carried a public/school-holiday rule we read around: the weekly pattern counts, the times are never shown. */
  holidayRule: boolean;
}

export interface OpenLateRow {
  osmId: string;
  name: string;
  kind: OpenLateKind;
  /** "until midnight" on Open late rows; "Open until 23:00" on Open tonight rows, empty when the time is not trusted or hidden. */
  closing: string;
  website: string | null;
  lat?: number | null;
  lon?: number | null;
  /** Neighbourhood from the static area file (lib/areas.ts), null when the place has none. */
  area?: string | null;
  /** ISO instants the browser sweep hides the row by: opening time and closing time of the late range. */
  start?: string;
  end?: string;
}

export const OPEN_LATE_MAX_ROWS = 24;
/** A neighbourhood gets its own heading only with at least this many places open late; the rest go under "Elsewhere". */
export const OPEN_LATE_MIN_PER_AREA = 2;
export const OPEN_LATE_MAX_PER_AREA = 4;
/** A snapshot older than this gives no Open late block (owner 2026-10-29). */
export const SNAPSHOT_MAX_AGE_DAYS = 14;
const KINDS: Record<string, OpenLateKind> = { pub: 'Pub', bar: 'Bar', nightclub: 'Nightclub', restaurant: 'Restaurant', cafe: 'Cafe' };

interface OverpassElement { type: string; id: number; timestamp?: string; tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number } }

function coordOf(el: OverpassElement): { lat: number | null; lon: number | null } {
  const lat = el.center?.lat ?? el.lat;
  const lon = el.center?.lon ?? el.lon;
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : { lat: null, lon: null };
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
    const hours = parseOpeningHoursLoose(t.opening_hours);
    if (!hours) continue;
    const key = `${t.name.toLowerCase()}|${t.amenity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ osmId: `${el.type}/${el.id}`, name: t.name, kind: KINDS[t.amenity], week: hours.week, website: safeWebsite(t.website ?? t['contact:website']), ...coordOf(el),
      checkDate: /^\d{4}-\d{2}-\d{2}$/.test(t.check_date ?? '') ? (t.check_date ?? null) : null, editedAt: el.timestamp ?? null, holidayRule: hours.holidayRule });
  }
  return out;
}

/** Weekday of a day number (days since epoch) as 0 = Monday. 1970-01-01 was a Thursday. */
export const weekdayOf = (day: number) => (((day + 3) % 7) + 7) % 7;

export const KIND_RANK: Record<OpenLateKind, number> = { Nightclub: 0, Bar: 1, Pub: 2, Restaurant: 3, Cafe: 4 };

/** Places open past 11 pm on the local calendar `day`, latest closing first (then nightclubs, bars, pubs, restaurants, then name). */
export function openLateRows(places: OsmPlace[], day: number, tz: string, max = OPEN_LATE_MAX_ROWS): OpenLateRow[] {
  const date = new Date(day * 86_400_000);
  const midnight = new Date(localMidnightIso({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }, tz)).getTime();
  const rows: Array<OpenLateRow & { endMin: number }> = [];
  for (const p of places) {
    // Open late is the exact-hours, no-cafe list the threshold has always counted: places read around a holiday rule and cafes belong to Open tonight only.
    if (p.kind === 'Cafe' || p.holidayRule) continue;
    const r = lateRange(p.week, weekdayOf(day));
    if (!r) continue;
    rows.push({
      osmId: p.osmId, name: p.name, kind: p.kind, closing: closingLabel(r), website: p.website, lat: p.lat, lon: p.lon,
      start: new Date(midnight + r.start * 60_000).toISOString(), end: new Date(midnight + r.end * 60_000).toISOString(), endMin: r.end,
    });
  }
  rows.sort((a, b) => b.endMin - a.endMin || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name));
  return rows.slice(0, max).map(({ endMin: _e, ...row }) => row);
}

/** Canonical venue spelling (lib/evening-names.ts) and neighbourhood for each row. `areas.places` is keyed by the normalised OSM name. */
export function decorateOpenLate(rows: OpenLateRow[], townId: string, areaData: AreaData | null | undefined): OpenLateRow[] {
  return rows.map((r) => ({ ...r, name: canonicalVenue(r.name, townId) ?? r.name, area: areaData?.places?.[normVenue(r.name)] ?? null }));
}

export interface OpenLateGroup { area: string | null; rows: OpenLateRow[] }

/** Open late as shown: neighbourhoods with at least OPEN_LATE_MIN_PER_AREA places keep their OPEN_LATE_MAX_PER_AREA latest-closing ones,
 *  every other place (single-place or unmapped neighbourhoods) goes under "Elsewhere" (area null, last), OPEN_LATE_MAX_ROWS in all,
 *  latest closing first. `rows` must be in that order (openLateRows) and carry their area (decorateOpenLate). */
export function groupOpenLateByArea(rows: OpenLateRow[], maxRows = OPEN_LATE_MAX_ROWS): OpenLateGroup[] {
  const perArea = new Map<string, number>();
  for (const r of rows) if (r.area) perArea.set(r.area, (perArea.get(r.area) ?? 0) + 1);
  const taken = new Map<string, number>();
  const chosen = rows.filter((r) => {
    if (!r.area || (perArea.get(r.area) ?? 0) < OPEN_LATE_MIN_PER_AREA) return true;
    const n = taken.get(r.area) ?? 0;
    taken.set(r.area, n + 1);
    return n < OPEN_LATE_MAX_PER_AREA;
  }).slice(0, maxRows);
  const groups: OpenLateGroup[] = [];
  const elsewhere: OpenLateRow[] = [];
  for (const r of chosen) {
    if (!r.area || (perArea.get(r.area) ?? 0) < OPEN_LATE_MIN_PER_AREA) { elsewhere.push(r); continue; }
    const at = groups.find((g) => g.area === r.area);
    if (at) at.rows.push(r); else groups.push({ area: r.area, rows: [r] });
  }
  return elsewhere.length ? [...groups, { area: null, rows: elsewhere }] : groups;
}

export interface OsmSnapshot { fetchedAt: string; elements: unknown[] }

/** The stored snapshot as places, or null when there is none or it is older than SNAPSHOT_MAX_AGE_DAYS (then the page has no Open late block). */
/** Places open late per local day number for `days` evenings from `fromDay` (feeds the threshold's Open late group, never its items). */
export function openLateCounts(places: OsmPlace[], fromDay: number, days: number, tz: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (let d = fromDay; d < fromDay + days; d++) out[d] = openLateRows(places, d, tz, Number.MAX_SAFE_INTEGER).length;
  return out;
}

export function placesFromSnapshot(snapshot: OsmSnapshot | null, now: Date): OsmPlace[] | null {
  if (!snapshot) return null;
  const age = now.getTime() - new Date(snapshot.fetchedAt).getTime();
  if (Number.isNaN(age) || age > SNAPSHOT_MAX_AGE_DAYS * 86_400_000) return null;
  return placesFromOverpass(snapshot.elements as OverpassElement[]);
}
