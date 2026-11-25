/** One place's effective opening hours, in the place_hours row shape every reader already understands (owner order D,
 *  2026-11-25). DB-free and client-safe (type-only imports), like lib/place-hours.ts.
 *
 *  Sources, first that exists wins:
 *    1. place_hours rows (split hours, exceptions; what the facility page has always read)
 *    2. hours_structured: a plain week, or the season form {"seasons": [{from: "MM-DD", to: "MM-DD", label, week}]} written by
 *       ai_pipeline/facility_hours.py. A season recurs every year; an interval may run over New Year ("08-16".."05-31").
 *  The season in force on a date picks the week. Display (table, weekly line) uses the week in force on the build date;
 *  the open/closed pill gets rows dated per day (valid_from = valid_to = that day) for the days around the build, so a
 *  season boundary during the week is honoured by computePlaceOpenStatus without a rebuild. */
import type { PlaceHoursRow, StructuredHours } from './db';

export interface Season { from: string; to: string; label?: string; week: StructuredHours }
export interface SeasonalHours { seasons: Season[] }
export type StoredHours = StructuredHours | SeasonalHours;

const DAY_KEYS: (keyof StructuredHours)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Days of pill rows built around the build date: yesterday (a window past midnight) plus two weeks, so a page that misses a
 *  daily build or two still has a full week ahead to scan. */
const CLIENT_DAYS_BEFORE = 1;
const CLIENT_DAYS_AFTER = 14;

export function isSeasonal(h: StoredHours | null | undefined): h is SeasonalHours {
  return !!h && Array.isArray((h as SeasonalHours).seasons);
}

/** "MM-DD" inside [from, to], where an interval with from > to runs over New Year. */
export function inSeason(mmdd: string, from: string, to: string): boolean {
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

export function seasonOn(h: StoredHours | null, isoDate: string): Season | null {
  if (!isSeasonal(h)) return null;
  return h.seasons.find((s) => inSeason(isoDate.slice(5, 10), s.from, s.to)) ?? null;
}

/** The week in force on a date: the plain week, the covering season's week, or null (a date no season covers is unknown). */
export function weekOn(h: StoredHours | null, isoDate: string): StructuredHours | null {
  if (!h) return null;
  if (!isSeasonal(h)) return h;
  return seasonOn(h, isoDate)?.week ?? null;
}

/** "Apr 1–Dec 31" for a season's interval. */
export function seasonRangeLabel(s: Season): string {
  const fmt = (mmdd: string) => `${MONTH_ABBR[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3, 5))}`;
  return `${fmt(s.from)}–${fmt(s.to)}`;
}

/** One week as place_hours rows (day_of_week 0=Sunday); a closed day is a null/null row, the same "confirmed closed" row
 *  place-hours.ts already reads. */
export function rowsFromWeek(week: StructuredHours): PlaceHoursRow[] {
  return DAY_KEYS.map((k, i) => ({
    day_of_week: i, opens: week[k]?.[0] ?? null, closes: week[k]?.[1] ?? null, valid_from: null, valid_to: null,
  }));
}

function addDays(isoDate: string, n: number): { iso: string; weekday: number } {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return { iso: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}

/** Rows for the client pill: a plain week as-is; a seasonal one dated per day around `isoDate`. */
export function clientRows(h: StoredHours, isoDate: string): PlaceHoursRow[] {
  if (!isSeasonal(h)) return rowsFromWeek(h);
  const rows: PlaceHoursRow[] = [];
  for (let n = -CLIENT_DAYS_BEFORE; n <= CLIENT_DAYS_AFTER; n++) {
    const { iso, weekday } = addDays(isoDate, n);
    const week = weekOn(h, iso);
    if (!week) continue;
    const w = week[DAY_KEYS[weekday]];
    rows.push({ day_of_week: weekday, opens: w?.[0] ?? null, closes: w?.[1] ?? null, valid_from: iso, valid_to: iso });
  }
  return rows;
}

export interface EffectiveHours {
  /** The week in force on the build date (table, weekly line, lede). */
  rows: PlaceHoursRow[];
  /** What the open/closed pill reads (computePlaceOpenStatus). */
  pillRows: PlaceHoursRow[];
  /** The season in force, when the hours change through the year. */
  season: Season | null;
}

/** A place's effective hours on `isoDate` (the town's calendar date at build), or null when nothing is known. */
export function effectiveHours(
  place: { hours_structured: StoredHours | null }, placeHoursRows: PlaceHoursRow[], isoDate: string,
): EffectiveHours | null {
  if (placeHoursRows.length > 0) return { rows: placeHoursRows, pillRows: placeHoursRows, season: null };
  const h = place.hours_structured;
  const week = weekOn(h, isoDate);
  if (!h || !week) return null;
  return { rows: rowsFromWeek(week), pillRows: clientRows(h, isoDate), season: seasonOn(h, isoDate) };
}
