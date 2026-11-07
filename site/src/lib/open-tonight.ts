/** "Open tonight" (owner 2026-11-07): places from the weekly OpenStreetMap snapshot that are open after 18:00 town time, latest closing first,
 *  shown as "Open until 23:00". It extends the old Open late block on /tonight and has the same list on /today. Places are not events: nothing here
 *  counts toward the events indexing rule (lib/evening-threshold.ts keeps its own Open late count).
 *
 *  A place is listed only when its hours are exactly read AND fresh (`check_date` within 12 months OR the OSM last edit within 24 months; see
 *  hoursFresh), so every row has a closing time. Places whose only problem is a "PH off" rule are fine on ordinary days. On a day of the holiday
 *  calendar the whole section (and the cafe list) is left out. It exists only with at least 3 places open tonight. */
import { HOLIDAY_PAGE_DEFS } from '../config/holiday-pages/calendar';
import { occurrenceDay } from './holiday-calendar';
import { localMidnightIso, hasEnded } from './local-day';
import { OPEN_LATE_MAX_ROWS, KIND_RANK, weekdayOf, hoursFresh, type OsmPlace, type OpenLateRow } from './osm-open-late';
import type { HoursRange } from './osm-hours';

export const OPEN_TONIGHT_AFTER_MIN = 18 * 60;
export const OPEN_TONIGHT_MIN_PLACES = 3;
/** The evergreen "Open late in {Town}" page is indexed only with at least this many places that stay open past 11 pm. */
export const OPEN_LATE_PAGE_MIN_PLACES = 5;

const DAY = 86_400_000;

export { hoursFresh } from './osm-open-late';

/** "Open until 23:00", "Open until 01:00" (after midnight), "Open 24 hours". */
export function openUntilLabel(r: HoursRange): string {
  if (r.start === 0 && r.end === 1440) return 'Open 24 hours';
  const m = r.end % 1440;
  return `Open until ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Veterans Day and Thanksgiving are US holidays; Christmas Day is in every town's calendar. */
const US_ONLY = new Set(['veterans-day', 'thanksgiving']);

/** Is local day number `day` (days since epoch) one of the holidays of the holiday calendar (config/holiday-pages/calendar.ts) for this country?
 *  The dates come from the calendar's own rules whether or not the town has a page for that holiday. */
export function isHolidayDay(country: string, day: number): boolean {
  const year = new Date(day * DAY).getUTCFullYear();
  return HOLIDAY_PAGE_DEFS.some((def) => (country === 'us' || !US_ONLY.has(def.slug)) && [year - 1, year, year + 1].some((y) => occurrenceDay(def, y) / DAY === day));
}

function midnightOf(day: number, tz: string): number {
  const date = new Date(day * DAY);
  return new Date(localMidnightIso({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }, tz)).getTime();
}

interface Opts { day: number; tz: string; now: Date; holiday: boolean }

function rowFor(p: OsmPlace, r: HoursRange, o: Opts): OpenLateRow & { endMin: number } {
  const midnight = midnightOf(o.day, o.tz);
  return {
    osmId: p.osmId, name: p.name, kind: p.kind, closing: openUntilLabel(r), website: p.website, lat: p.lat, lon: p.lon,
    start: new Date(midnight + r.start * 60_000).toISOString(), end: new Date(midnight + r.end * 60_000).toISOString(), endMin: r.end,
  };
}

const compare = (a: { endMin: number; kind: OsmPlace['kind']; name: string }, b: typeof a) =>
  b.endMin - a.endMin || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name);

/** Pubs, bars, nightclubs and restaurants with fresh hours open after 18:00 on local day `day`, latest closing first (then kind, name). Nothing on a holiday.
 *  Not gated: the caller applies openTonightSection. Cafes are never in it. */
export function openTonightRows(places: OsmPlace[], o: Opts, max = OPEN_LATE_MAX_ROWS): OpenLateRow[] {
  if (o.holiday) return [];
  const rows: Array<OpenLateRow & { endMin: number }> = [];
  for (const p of places) {
    if (p.kind === 'Cafe' || !hoursFresh(p, o.now)) continue;
    const after = p.week[weekdayOf(o.day)].filter((r) => r.end > OPEN_TONIGHT_AFTER_MIN);
    if (after.length === 0) continue;
    rows.push(rowFor(p, after.reduce((a, b) => (b.end > a.end ? b : a)), o));
  }
  rows.sort(compare);
  return rows.slice(0, max).map(({ endMin: _e, ...row }) => row);
}

/** The section as shown: nothing at all (no heading, no message) unless at least 3 places are still open tonight (not yet closed at `now`). */
export function openTonightSection<T extends OpenLateRow>(rows: T[], now: Date, tz: string): T[] {
  const live = rows.filter((r) => !r.end || !hasEnded({ start: r.start ?? r.end, end: r.end }, now, tz));
  return live.length >= OPEN_TONIGHT_MIN_PLACES ? rows : [];
}

/** Cafes with hours today, for the daytime "open now" list on /today. The browser keeps the ones open at that moment (data-start/data-end) and shows
 *  the list only with at least 3; here, a holiday gives no list and fewer than 3 cafes still to close today gives none. */
export function cafeRows(places: OsmPlace[], o: Opts, max = OPEN_LATE_MAX_ROWS): OpenLateRow[] {
  if (o.holiday) return [];
  const rows: Array<OpenLateRow & { endMin: number }> = [];
  for (const p of places) {
    if (p.kind !== 'Cafe' || !hoursFresh(p, o.now)) continue;
    const today = p.week[weekdayOf(o.day)];
    if (today.length === 0) continue;
    // The range still to close, else the last one: a cafe with a split day (10-12, 14-18) is one row with the range that ends latest.
    rows.push(rowFor(p, today.reduce((a, b) => (b.end > a.end ? b : a)), o));
  }
  rows.sort(compare);
  return rows.slice(0, max).map(({ endMin: _e, ...row }) => row);
}

/** One evening's hours summed to the weekly pattern for the evergreen page: the nights a place stays open past 23:00 and its latest closing then. */
export interface LateNight { weekday: number; end: number }
export function lateNights(p: OsmPlace): LateNight[] {
  const out: LateNight[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const late = p.week[wd].filter((r) => r.end > 23 * 60);
    if (late.length) out.push({ weekday: wd, end: Math.max(...late.map((r) => r.end)) });
  }
  return out;
}

/** The places on the evergreen "Open late in {Town}" page: pubs, bars, nightclubs and restaurants that stay open past 23:00 on at least one night of the week. */
export function openLatePlaces(places: OsmPlace[]): OsmPlace[] {
  return places.filter((p) => p.kind !== 'Cafe' && lateNights(p).length > 0);
}
export const openLatePageIndexable = (places: OsmPlace[]): boolean => openLatePlaces(places).length >= OPEN_LATE_PAGE_MIN_PLACES;
