/** "Is this facility open right now" -- Recurring-traffic layer handoff,
 *  Phase 2. Pure function, DB-free (same split as lib/closure-watch.ts) --
 *  consumes db.ts's StructuredHours (see that interface's own comment for
 *  the shape ai_pipeline/facility_hours.py's parser produces) plus the
 *  current instant, and decides open/closed/unknown.
 *
 *  Three states, not two -- `known: false` ("no structured data") is a
 *  REAL, honest state, never silently collapsed into "closed". A facility
 *  whose hours_text couldn't be confidently parsed (hours_needs_review) or
 *  was never recorded at all must render "hours not available", not a
 *  false negative -- same "absent data is not evidence" principle
 *  closure-watch.ts's own module docstring already states for this
 *  codebase.
 */
import type { StructuredHours } from './db';

export type OpenStatus =
  | { known: false }
  | { known: true; isOpen: true; closesAt: string }
  | { known: true; isOpen: false; opensAt: string; opensLabel: string };

const DAY_KEYS: (keyof StructuredHours)[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** "09:00" -> "9:00 AM", "13:00" -> "1:00 PM" -- matches the 12-hour,
 *  no-leading-zero convention this site's other time formatting already
 *  uses (see lib/publish.py's fmt_time()/_fmt() equivalents on the Python
 *  side, same reasoning: readers think in 12-hour clock time). */
export function formatClock(hhmm: string, gb = false): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour12 = h % 12 || 12;
  // gb (owner 2026-10-28): "10am", "5:30pm" -- the same shape as country-profile's formatClockCompact.
  if (gb) return `${hour12}${m === 0 ? '' : `:${m.toString().padStart(2, '0')}`}${h < 12 ? 'am' : 'pm'}`;
  const period = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

/** A window from midnight to the end of the day (00:00-23:59, -24:00 or -00:00) is the whole day: shown as "Open 24 hours", never
 *  "12:00 AM–11:59 PM" (Broomfield AdSense plan F6, 2026-11-11: the recycling center read "midnight–11:59pm"). */
export function isRoundTheClock(opens: string, closes: string): boolean {
  return opens.slice(0, 5) === '00:00' && ['23:59', '24:00', '00:00'].includes(closes.slice(0, 5));
}

function localParts(instant: Date, timezone: string): { weekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekdayShort = get('weekday').toLowerCase();
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekdayShort);
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some locales render midnight as "24"
  const minute = Number(get('minute'));
  return { weekday, minutesOfDay: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function computeOpenStatus(hours: StructuredHours | null, now: Date, timezone: string, gb = false): OpenStatus {
  if (!hours) return { known: false };

  const { weekday, minutesOfDay } = localParts(now, timezone);
  const todayWindow = hours[DAY_KEYS[weekday]];
  // A window that closes at or before it opens ends the next day (11:00-02:00, 10:00-00:00; The Old Man Bar, 2026-11-13).
  const endsNextDay = (open: string, close: string) => toMinutes(close) <= toMinutes(open) && !isRoundTheClock(open, close);

  const yesterdayWindow = hours[DAY_KEYS[(weekday + 6) % 7]];
  if (yesterdayWindow && endsNextDay(...yesterdayWindow) && minutesOfDay < toMinutes(yesterdayWindow[1])) {
    return { known: true, isOpen: true, closesAt: formatClock(yesterdayWindow[1], gb) };
  }
  if (todayWindow) {
    const [open, close] = todayWindow;
    if (minutesOfDay >= toMinutes(open) && (endsNextDay(open, close) || minutesOfDay < toMinutes(close))) {
      return { known: true, isOpen: true, closesAt: formatClock(close, gb) };
    }
  }

  // Not open right now -- find the next real opening, scanning forward
  // through the week (today's later window first, if today hasn't opened
  // yet; otherwise the next day that has one, up to 7 days out so a
  // facility open exactly one day a week is still found).
  for (let offset = 0; offset < 7; offset++) {
    const dayIndex = (weekday + offset) % 7;
    const window = hours[DAY_KEYS[dayIndex]];
    if (!window) continue;
    const [open] = window;
    if (offset === 0 && toMinutes(open) <= minutesOfDay) continue; // today's window already passed
    const label = offset === 0 ? 'today'
      : offset === 1 ? 'tomorrow'
      : DAY_KEYS[dayIndex].replace(/^(.)/, (c) => c.toUpperCase());
    return { known: true, isOpen: false, opensAt: formatClock(open, gb), opensLabel: label };
  }

  // Every day is null -- a real, if unusual, "never open" facility record.
  return { known: true, isOpen: false, opensAt: '', opensLabel: 'not open this week' };
}

const SCHEMA_DAY_NAMES: Record<keyof StructuredHours, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

/** Answer-engine-visibility handoff, Section 3: `openingHoursSpecification`
 *  for facility JSON-LD -- one entry per day the facility is actually
 *  open, straight from the same `hours_structured` data the visible "Open
 *  now"/"Closed" badge above already renders from (computeOpenStatus()),
 *  never a second, independently-derived guess. `opens`/`closes` are
 *  passed through as-is: schema.org's own time format for this property is
 *  bare 24h "HH:MM", which is exactly what StructuredHours already stores
 *  (no formatClock() 12-hour conversion needed here -- that's for the
 *  human-readable badge only). Returns undefined (never an empty array)
 *  when there's no structured data at all, or the parser found nothing
 *  open a single day -- same "resolved or nothing" rule the facility page's
 *  own address block already follows, so a caller can drop this straight
 *  into a conditional spread without an extra emptiness check. */
export function buildOpeningHoursSpecification(hours: StructuredHours | null): Record<string, unknown>[] | undefined {
  if (!hours) return undefined;
  const specs = (Object.keys(SCHEMA_DAY_NAMES) as (keyof StructuredHours)[])
    .filter((day) => hours[day] !== null)
    .map((day) => {
      const [opens, closes] = hours[day]!;
      return {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${SCHEMA_DAY_NAMES[day]}`,
        opens,
        closes,
      };
    });
  return specs.length > 0 ? specs : undefined;
}
