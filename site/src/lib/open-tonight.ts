/** "Open tonight" (owner 2026-11-07): places from the weekly OpenStreetMap snapshot that are open after 18:00 town time, latest closing first,
 *  shown as "Open until 23:00". It extends the old Open late block on /tonight and has the same list on /today. Places are not events: nothing here
 *  counts toward the events indexing rule (lib/evening-threshold.ts keeps its own Open late count).
 *
 *  A time is shown only when the place's data is recent enough: `check_date` within 12 months OR the OSM element's last edit within 24 months.
 *  Otherwise the place is listed without a time. On a holiday of the town's holiday calendar no time and no "open now" is shown at all (hours
 *  on holidays are the thing OSM data is least often right about). The section exists only with at least 3 places open tonight. */
import { HOLIDAY_PAGE_DEFS } from '../config/holiday-pages/calendar';
import { occurrenceDay } from './holiday-calendar';
import { localMidnightIso, hasEnded } from './local-day';
import { OPEN_LATE_MAX_ROWS, KIND_RANK, weekdayOf, type OsmPlace, type OpenLateRow } from './osm-open-late';
import type { HoursRange } from './osm-hours';

export const OPEN_TONIGHT_AFTER_MIN = 18 * 60;
export const OPEN_TONIGHT_MIN_PLACES = 3;
export const CHECK_DATE_MAX_MONTHS = 12;
export const LAST_EDIT_MAX_MONTHS = 24;
/** The evergreen "Open late in {Town}" page is indexed only with at least this many places that stay open past 11 pm. */
export const OPEN_LATE_PAGE_MIN_PLACES = 5;

const DAY = 86_400_000;

function monthsBefore(now: Date, months: number): number {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

/** True when the hours of this place are recent enough to show a time: check_date <= 12 months old OR last OSM edit <= 24 months old. */
export function timesTrusted(p: Pick<OsmPlace, 'checkDate' | 'editedAt' | 'holidayRule'>, now: Date): boolean {
  if (p.holidayRule) return false;
  const checked = p.checkDate ? Date.parse(p.checkDate) : NaN;
  if (Number.isFinite(checked) && checked >= monthsBefore(now, CHECK_DATE_MAX_MONTHS) && checked <= now.getTime() + DAY) return true;
  const edited = p.editedAt ? Date.parse(p.editedAt) : NaN;
  return Number.isFinite(edited) && edited >= monthsBefore(now, LAST_EDIT_MAX_MONTHS);
}

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

function rowFor(p: OsmPlace, r: HoursRange, o: Opts): OpenLateRow & { endMin: number; timed: boolean } {
  const timed = !o.holiday && timesTrusted(p, o.now);
  const midnight = midnightOf(o.day, o.tz);
  return {
    osmId: p.osmId, name: p.name, kind: p.kind, closing: timed ? openUntilLabel(r) : '', website: p.website, lat: p.lat, lon: p.lon,
    // On a holiday there is no sweep either ("open now" is not claimed): the row carries no instants.
    ...(o.holiday ? {} : { start: new Date(midnight + r.start * 60_000).toISOString(), end: new Date(midnight + r.end * 60_000).toISOString() }),
    endMin: r.end, timed,
  };
}

const compare = (a: { timed: boolean; endMin: number; kind: OsmPlace['kind']; name: string }, b: typeof a) =>
  Number(b.timed) - Number(a.timed) || (a.timed ? b.endMin - a.endMin : 0) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name);

/** Pubs, bars, nightclubs and restaurants open after 18:00 on local day `day`, timed ones first by closing time (latest first), the rest by kind and name.
 *  Not gated: the caller applies openTonightSection. Cafes are never in it. */
export function openTonightRows(places: OsmPlace[], o: Opts, max = OPEN_LATE_MAX_ROWS): OpenLateRow[] {
  const rows: Array<OpenLateRow & { endMin: number; timed: boolean }> = [];
  for (const p of places) {
    if (p.kind === 'Cafe') continue;
    const after = p.week[weekdayOf(o.day)].filter((r) => r.end > OPEN_TONIGHT_AFTER_MIN);
    if (after.length === 0) continue;
    rows.push(rowFor(p, after.reduce((a, b) => (b.end > a.end ? b : a)), o));
  }
  rows.sort(compare);
  return rows.slice(0, max).map(({ endMin: _e, timed: _t, ...row }) => row);
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
  const rows: Array<OpenLateRow & { endMin: number; timed: boolean }> = [];
  for (const p of places) {
    if (p.kind !== 'Cafe') continue;
    const today = p.week[weekdayOf(o.day)];
    if (today.length === 0) continue;
    // The range still to close, else the last one: a cafe with a split day (10-12, 14-18) is one row with the range that ends latest.
    rows.push(rowFor(p, today.reduce((a, b) => (b.end > a.end ? b : a)), o));
  }
  rows.sort(compare);
  return rows.slice(0, max).map(({ endMin: _e, timed: _t, ...row }) => row);
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
