/** Broomfield place-layer handoff, Step 4: "open now or not" for the new
 *  `place_hours`/`place_hours_exceptions` schema (db/migrations/045).
 *
 *  Deliberately a SEPARATE module from lib/facility-hours.ts, not an
 *  extension of it -- that file's computeOpenStatus() reads the OLD
 *  hours_structured JSONB (one [open,close] tuple per day, no split-hours,
 *  no exceptions), which every existing /facilities/ route in all three
 *  towns still depends on unchanged. This module reads real rows from
 *  `place_hours` (day_of_week 0=Sunday..6=Saturday, multiple rows per day
 *  allowed for split hours) and `place_hours_exceptions` (always overrides
 *  the regular weekly rows for its own date), per the handoff's own 3.3/3.4
 *  rules.
 *
 *  Must be computed server-side at build time in the town's own timezone,
 *  per the handoff's own explicit instruction -- never in browser JS from a
 *  hardcoded offset (the exact Neon DATE/local-time bug that already hit
 *  this project once, see verified_date's own formatCalendarDate() history).
 */
import type { PlaceHoursRow, PlaceHoursException } from './db';
import { formatClock } from './facility-hours';

export type PlaceOpenStatus =
  | { known: false }
  | { known: true; isOpen: true; closesAt: string }
  | { known: true; isOpen: false; opensAt: string; opensLabel: string }
  | { known: true; isOpen: false; opensAt: null; opensLabel: null };

function toMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

function localParts(instant: Date, timezone: string): { weekday: number; isoDate: string; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekdayShort = get('weekday').toLowerCase();
  // 0=Sunday..6=Saturday, matching place_hours.day_of_week's own convention.
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekdayShort);
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  return { weekday, isoDate, minutesOfDay: hour * 60 + minute };
}

/** A given calendar date's windows: the day's exception if one exists
 *  (always wins, per the handoff's own "exceptions always override" rule --
 *  an exception with both opens/closes NULL means closed all day, a real,
 *  sourced fact, not "unknown"), otherwise every regular place_hours row
 *  for that weekday whose valid_from/valid_to (if set) covers the date. */
function windowsForDate(
  isoDate: string, weekday: number, hours: PlaceHoursRow[], exceptions: PlaceHoursException[],
): { opens: string; closes: string }[] {
  const exception = exceptions.find((e) => e.date === isoDate);
  if (exception) {
    return exception.opens && exception.closes ? [{ opens: exception.opens, closes: exception.closes }] : [];
  }
  return hours
    .filter((h) => h.day_of_week === weekday)
    .filter((h) => (!h.valid_from || h.valid_from <= isoDate) && (!h.valid_to || h.valid_to >= isoDate))
    .map((h) => ({ opens: h.opens, closes: h.closes }));
}

/** hours.length === 0 is the caller's own signal for "no structured data at
 *  all" (hours_confidence !== 'structured') -- returns `known: false`
 *  before ever touching exceptions, same "absent data is not evidence"
 *  principle lib/facility-hours.ts's own computeOpenStatus() already
 *  states. Scans up to 7 days ahead for the next real opening, same bound
 *  as the existing facility version, for the same reason (a place open
 *  exactly one day a week is still found). Does NOT apply exceptions to
 *  future days in this scan -- only to `now`'s own date -- since upcoming
 *  exceptions are already surfaced separately as their own list on the
 *  page (handoff 5.1); this keeps the "opens next at" fallback message
 *  simple rather than silently promising a time an exception might still
 *  override closer to the date. */
export function computePlaceOpenStatus(
  hours: PlaceHoursRow[], exceptions: PlaceHoursException[], now: Date, timezone: string,
): PlaceOpenStatus {
  if (hours.length === 0) return { known: false };

  const { weekday, isoDate, minutesOfDay } = localParts(now, timezone);
  const todayWindows = windowsForDate(isoDate, weekday, hours, exceptions);

  for (const w of todayWindows) {
    if (minutesOfDay >= toMinutes(w.opens) && minutesOfDay < toMinutes(w.closes)) {
      return { known: true, isOpen: true, closesAt: formatClock(w.closes) };
    }
  }

  for (let offset = 0; offset < 7; offset++) {
    const future = new Date(now.getTime() + offset * 86_400_000);
    const futureParts = localParts(future, timezone);
    const windows = offset === 0 ? todayWindows : windowsForDate(futureParts.isoDate, futureParts.weekday, hours, []);
    for (const w of windows) {
      if (offset === 0 && toMinutes(w.opens) <= minutesOfDay) continue; // today's window already passed
      const label = offset === 0 ? 'today'
        : offset === 1 ? 'tomorrow'
        : new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(future);
      return { known: true, isOpen: false, opensAt: formatClock(w.opens), opensLabel: label };
    }
  }

  return { known: true, isOpen: false, opensAt: null, opensLabel: null };
}

const SCHEMA_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Handoff Section 5.2: `openingHoursSpecification` from real `place_hours`
 *  rows -- the caller (place/[slug].astro) only calls this when
 *  hours_confidence === 'structured' AND the data is inside its staleness
 *  threshold, per the handoff's own explicit rule ("emitting stale hours
 *  as schema is worse than emitting none"); this function itself doesn't
 *  re-check either condition, it just converts whatever rows it's given.
 *  One spec entry per row (not collapsed by shared hours across days) --
 *  schema.org allows an array for dayOfWeek, but place_hours already
 *  stores one row per day, so collapsing would be a lossy round-trip for
 *  no real benefit here. */
export function buildPlaceOpeningHoursSpecification(hours: PlaceHoursRow[]): Record<string, unknown>[] {
  return hours.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: `https://schema.org/${SCHEMA_DAY_NAMES[h.day_of_week]}`,
    opens: h.opens.slice(0, 5),
    closes: h.closes.slice(0, 5),
    ...(h.valid_from ? { validFrom: h.valid_from } : {}),
    ...(h.valid_to ? { validThrough: h.valid_to } : {}),
  }));
}

/** Handoff Section 4: staleness. `verifiedDate` is a bare "YYYY-MM-DD"
 *  string (places.verified_date is DATE, not TIMESTAMPTZ -- see
 *  NEEDS-HUMAN-REVIEW.md #68 for why that's the real, existing field this
 *  reads, not a separately-added last_verified_at). Compares in UTC calendar
 *  days, not town-local time -- a staleness THRESHOLD measured in whole
 *  days doesn't need town-timezone precision the open/closed check above
 *  does; a day's difference either way at a 45- or 180-day threshold
 *  changes nothing real. */
export function isPastStalenessThreshold(verifiedDate: string | null, thresholdDays: number, now: Date): boolean {
  if (!verifiedDate) return true; // never verified is at least as stale as "too old"
  const verified = new Date(`${verifiedDate}T00:00:00Z`);
  const ageDays = (now.getTime() - verified.getTime()) / 86_400_000;
  return ageDays > thresholdDays;
}
