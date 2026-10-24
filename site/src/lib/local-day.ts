/** Browser-side "what is happening today / tonight / tomorrow" arithmetic.
 *
 *  The site is static and a build can be hours old by the time someone reads
 *  it, so anything that depends on "now" is decided here, in the visitor's
 *  browser, from `data-start` / `data-end` instants and the TOWN's IANA zone
 *  -- never the visitor's own zone and never the build machine's.
 *
 *  Pure functions of (events, now, timezone) so vitest can pin the clock,
 *  including under TZ=UTC and TZ=Europe/Stockholm.
 */

export interface TimedEvent {
  /** ISO instant the event starts. */
  start: string;
  /** ISO instant it ends, or null/'' when the source has no end. */
  end?: string | null;
}

export const TONIGHT_FROM_HOUR = 17;
/** An event with a known start but no end is treated as over this long after it
 *  starts (owner rule: a passed event must never sit under Today/Tonight). */
export const DEFAULT_EVENT_MS = 3 * 3_600_000;

function parts(d: Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, min: g('minute') };
}

/** Calendar-day number (days since epoch) of an instant in `timezone`. */
export function localDayNumber(d: Date, timezone: string): number {
  const { y, m, d: day } = parts(d, timezone);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function localHourOf(d: Date, timezone: string): number {
  return parts(d, timezone).h;
}

/** All-day item: starts at local midnight and has no real end (none, or not after
 *  the start) -- the rule eventEndsAt() applies below -- or whose "end" is itself
 *  a later local midnight (a source that writes an all-day event as 00:00 ->
 *  next 00:00, e.g. Hobo Day 2026-10-24 -> 2026-10-25). Display code shows
 *  "All day" for these instead of "12:00 AM". An end at any other time of day
 *  is a real end and keeps the clock. */
/** ISO instant of local midnight at the start of the given calendar day in `timezone`. */
export function localMidnightIso(day: { y: number; m: number; d: number }, timezone: string): string {
  const want = Date.UTC(day.y, day.m - 1, day.d);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(t), timezone);
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return new Date(t).toISOString();
}

export function isAllDay(e: TimedEvent, timezone: string): boolean {
  const start = new Date(e.start);
  if (Number.isNaN(start.getTime())) return false;
  const sp = parts(start, timezone);
  if (sp.h !== 0 || sp.min !== 0) return false;
  if (e.end) {
    const end = new Date(e.end);
    if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
      const ep = parts(end, timezone);
      return ep.h === 0 && ep.min === 0;
    }
  }
  return true;
}

/** The instant an event stops counting as "happening". A no-end event that
 *  starts at local midnight is an all-day item: it lasts until local midnight. */
export function eventEndsAt(e: TimedEvent, timezone: string): Date {
  const start = new Date(e.start);
  if (e.end) {
    const end = new Date(e.end);
    if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) return end;
  }
  const p = parts(start, timezone);
  if (p.h === 0 && p.min === 0) {
    // next local midnight, DST-safe: walk forward until the local day number changes
    const day = localDayNumber(start, timezone);
    let t = start.getTime();
    while (localDayNumber(new Date(t), timezone) === day) t += 30 * 60_000;
    return new Date(t);
  }
  return new Date(start.getTime() + DEFAULT_EVENT_MS);
}

export function hasEnded(e: TimedEvent, now: Date, timezone: string): boolean {
  return eventEndsAt(e, timezone).getTime() <= now.getTime();
}

export type DayBucket = 'tonight' | 'tomorrow' | null;

/** Which /today bucket an event belongs to RIGHT NOW. Ended events belong to
 *  none. "Tonight" = starts today (local) at/after 17:00. */
export function bucketOf(e: TimedEvent, now: Date, timezone: string): DayBucket {
  if (hasEnded(e, now, timezone)) return null;
  const start = new Date(e.start);
  const delta = localDayNumber(start, timezone) - localDayNumber(now, timezone);
  if (delta === 0 && localHourOf(start, timezone) >= TONIGHT_FROM_HOUR) return 'tonight';
  if (delta === 1) return 'tomorrow';
  return null;
}

/** Events on today's local calendar day that haven't ended yet ("N events
 *  today"). */
export function countToday(events: TimedEvent[], now: Date, timezone: string): number {
  const today = localDayNumber(now, timezone);
  return events.filter((e) =>
    localDayNumber(new Date(e.start), timezone) === today && !hasEnded(e, now, timezone)).length;
}

export function countTonight(events: TimedEvent[], now: Date, timezone: string): number {
  return events.filter((e) => bucketOf(e, now, timezone) === 'tonight').length;
}

/** "today" / "tomorrow" / "in N days" for a future instant, in town-local days. */
export function relativeDayLabel(target: Date, now: Date, timezone: string): string {
  const n = localDayNumber(target, timezone) - localDayNumber(now, timezone);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

/** Build-time companion to the browser's data-hide-ended sweep: drops stories that
 *  have already finished, so a page built after an event never prints it as upcoming
 *  (the listing query keeps a 12 h grace window, which put last night's concert
 *  under "Today"). Stories without a start are kept. */
export function withoutEnded<T extends { occurs_at?: string | Date | null; ends_at?: string | Date | null }>(
  items: T[], now: Date, timezone: string,
): T[] {
  return items.filter((s) => {
    if (!s.occurs_at) return true;
    const start = new Date(s.occurs_at).toISOString();
    const end = s.ends_at ? new Date(s.ends_at).toISOString() : null;
    return !hasEnded({ start, end }, now, timezone);
  });
}
