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
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
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

export function computeOpenStatus(hours: StructuredHours | null, now: Date, timezone: string): OpenStatus {
  if (!hours) return { known: false };

  const { weekday, minutesOfDay } = localParts(now, timezone);
  const todayWindow = hours[DAY_KEYS[weekday]];

  if (todayWindow) {
    const [open, close] = todayWindow;
    if (minutesOfDay >= toMinutes(open) && minutesOfDay < toMinutes(close)) {
      return { known: true, isOpen: true, closesAt: formatClock(close) };
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
    return { known: true, isOpen: false, opensAt: formatClock(open), opensLabel: label };
  }

  // Every day is null -- a real, if unusual, "never open" facility record.
  return { known: true, isOpen: false, opensAt: '', opensLabel: 'not open this week' };
}
