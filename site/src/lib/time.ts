/**
 * Relative time language -- see NEEDS-HUMAN-REVIEW.md "Liveliness Spec" §2.
 * "2026-08-25" is a database value; a person writes "yesterday".
 *
 * Resolved in the TOWN's timezone, never the build machine's -- the same bug
 * class already fixed once for getLatestEmployerRatings() (a naive
 * new Date().toISOString() classifies a late-evening Pacific action as the
 * wrong calendar day the instant UTC crosses midnight while Pacific hasn't
 * yet). relativeTime() takes `now` as an explicit parameter rather than
 * reading the system clock internally -- this is also what makes it
 * trivially testable regardless of the machine's own timezone (see
 * time.test.ts): every test passes its own fixed `now`, so "run the suite
 * with the machine clock set to a non-UTC zone" (§7) can't affect the
 * result even by accident.
 *
 * Zoned calendar-date comparisons use Intl.DateTimeFormat's zoned parts to
 * build a UTC-midnight-normalized Date for both `date` and `now`, then diff
 * in whole days -- the same "never do manual UTC-offset arithmetic" pattern
 * already established in server/_shared.ts's currentIsoWeekSlug() and
 * todayInTimezone(). Manual offset math is exactly the class of bug DST
 * transitions expose.
 *
 * Callers, not this module, are responsible for:
 *   - never calling this for an alert's effective window (alerts keep exact
 *     times, see §2's own rule)
 *   - preferring a recurring event's cadence ("every Tuesday at six", from
 *     the tone-v2 meta.recurrence field) over calling relativeTime() on a
 *     single instance date, when a cadence is available
 *   - wrapping the returned text in <time datetime="..."> with the real
 *     ISO value as the machine-readable attribute
 */

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function zonedMidnightUtc(date: Date, timeZone: string): number {
  const { year, month, day } = zonedParts(date, timeZone);
  return Date.UTC(year, month - 1, day);
}

/** Whole calendar-day difference (`date` minus `now`), in the given
 *  timezone -- 0 for the same day, 1 for tomorrow, -1 for yesterday, etc.
 *  Never affected by either instant's time-of-day, only its zoned date.
 *  Exported for db.ts's countdown() (item B3) -- the same town-local-day
 *  arithmetic this module already uses for relativeTime(), reused rather
 *  than re-implemented a second time with its own UTC-midnight-normalize
 *  logic. */
export function calendarDayDiff(date: Date, now: Date, timeZone: string): number {
  const oneDayMs = 86_400_000;
  return Math.round((zonedMidnightUtc(date, timeZone) - zonedMidnightUtc(now, timeZone)) / oneDayMs);
}

function formatClockTime(hour24: number, minute: number): string {
  const period = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 || 12;
  return minute === 0 ? `${hour12}${period}` : `${hour12}:${String(minute).padStart(2, '0')}${period}`;
}

function weekdayName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(date);
}

function monthDay(date: Date, timeZone: string, withYear: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(date);
}

function pastText(date: Date, now: Date, timeZone: string): string {
  const diffMinutes = (now.getTime() - date.getTime()) / 60_000;
  if (diffMinutes < 60) return 'just now';

  const dayDiff = calendarDayDiff(date, now, timeZone); // negative: date is before now
  const { hour, year } = zonedParts(date, timeZone);

  if (dayDiff === 0) {
    if (hour < 12) return 'this morning';
    if (hour < 17) return 'this afternoon';
    return 'this evening';
  }
  if (dayDiff === -1) return 'yesterday';
  if (dayDiff >= -6) return weekdayName(date, timeZone);

  const sameYear = year === zonedParts(now, timeZone).year;
  return monthDay(date, timeZone, !sameYear);
}

function futureText(date: Date, now: Date, timeZone: string): string {
  const dayDiff = calendarDayDiff(date, now, timeZone); // positive: date is after now
  const { hour, minute, year } = zonedParts(date, timeZone);
  const clock = formatClockTime(hour, minute);

  if (dayDiff === 0) return `today at ${clock}`;
  if (dayDiff === 1) return `tomorrow at ${clock}`;
  if (dayDiff <= 6) return `${weekdayName(date, timeZone)} at ${clock}`;
  if (dayDiff <= 13) return `next ${weekdayName(date, timeZone)}`;

  const sameYear = year === zonedParts(now, timeZone).year;
  return monthDay(date, timeZone, !sameYear);
}

/** Human, town-timezone-aware relative time for `date` relative to `now`.
 *  Lowercase throughout except month/weekday names, per §2. Picks the past
 *  or future table automatically from the sign of (date - now).
 *
 *  2026-10-02, item C2: `endsAt` is optional and additive -- every existing
 *  call site (none of which has an end time to pass) is unaffected. Without
 *  it, pastText()'s own "just now" (< 60 minutes since `date`) is the only
 *  "this is current" signal, which fires identically whether the thing
 *  being described is still happening or has already ended -- a 90-minute
 *  event reads "just now" for its first 60 minutes and then silently jumps
 *  straight to "this morning"/"this afternoon" with no signal that it's
 *  still actually in progress for its remaining half hour. When `endsAt` IS
 *  given, "now" is reported for the exact `date <= now < endsAt` window
 *  instead of the coarser time-since-start heuristic -- a real in-progress
 *  check, not a proxy for one. */
export function relativeTime(
  date: Date | string, now: Date, timeZone: string, endsAt?: Date | string | null,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (endsAt != null) {
    const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;
    if (d.getTime() <= now.getTime() && now.getTime() < end.getTime()) return 'now';
  }
  return d.getTime() <= now.getTime() ? pastText(d, now, timeZone) : futureText(d, now, timeZone);
}

/** 2026-10-02, item C1: a compact "{DAY} · {TIME}" kicker for an event's
 *  own card -- e.g. "Thu · 7:30 PM". Deliberately NOT relativeTime()'s
 *  casual relative language ("tomorrow at 7:30pm") -- a kicker is scanned,
 *  not read as prose, so an absolute weekday + a conventionally-capitalized
 *  clock time (space + uppercase AM/PM, unlike relativeTime()'s own
 *  lowercase-no-space "7:30pm") reads faster in a dense list. Always the
 *  short weekday form ("Thu"), regardless of how far out the date is --
 *  unlike relativeTime()'s futureText(), which switches to a month/day
 *  format past ~2 weeks out; this is for a SINGLE EVENT's own card, where
 *  the exact date is already shown elsewhere on the card (or is today/soon
 *  by construction of whatever list rendered the card), not a general-
 *  purpose "how far away is this" sentence. */
export function dayTimeKicker(date: Date | string, timeZone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const { hour, minute } = zonedParts(d, timeZone);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(d);
  const period = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 || 12;
  const clock = minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
  return `${day} · ${clock}`;
}

/** Item D2: whether a single event instance is over, for the detail page's
 *  own "This event has passed" notice. Checked against `endsAt` when given
 *  (the real end of the window -- same field C2's relativeTime() fix above
 *  threads through), falling back to `occursAt` (the start time) for the
 *  many single-instant events with no `endsAt` at all. `occursAt == null`
 *  (a content-track row with no real date, see callers' own byline/occurs_at
 *  split) returns false rather than treating a missing date as "passed". */
export function hasEventPassed(
  occursAt: Date | string | null, endsAt: Date | string | null | undefined, now: Date,
): boolean {
  if (!occursAt) return false;
  const reference = endsAt ?? occursAt;
  const d = typeof reference === 'string' ? new Date(reference) : reference;
  return d.getTime() < now.getTime();
}
