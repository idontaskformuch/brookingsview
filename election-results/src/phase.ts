/** Spec 2d cadence, evaluated in the town's own timezone from an injected clock.
 *  before  -> no fetching ("Results will appear after polls close")
 *  night   -> every cron tick (every 10 min) from polls close until 02:00 the next day
 *  after   -> twice a day (07:00 and 19:00 local, first tick of the hour) until fetchUntil
 *  done    -> stop */
export type Phase = 'before' | 'night' | 'after' | 'done';

export interface Cadence {
  electionDate: string; // YYYY-MM-DD
  timezone: string;
  /** Local "HH:MM" when fetching starts on election day (polls close). */
  startLocal: string;
  /** Last local date (YYYY-MM-DD, inclusive) on which fetching still runs. */
  fetchUntil: string;
}

function localParts(now: Date, tz: string): { date: string; minutes: number; minuteOfHour: number; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + minute, minuteOfHour: minute, hour };
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function phaseAt(now: Date, c: Cadence): Phase {
  const l = localParts(now, c.timezone);
  const [sh, sm] = c.startLocal.split(':').map(Number);
  const start = sh * 60 + sm;
  const after = nextDay(c.electionDate);
  if (l.date < c.electionDate) return 'before';
  if (l.date === c.electionDate) return l.minutes < start ? 'before' : 'night';
  if (l.date === after && l.minutes < 2 * 60) return 'night';
  if (l.date > c.fetchUntil) return 'done';
  return 'after';
}

/** Whether this cron tick should fetch. `after` fetches on the first tick of 07:00 and 19:00 local. */
export function shouldFetch(now: Date, c: Cadence): boolean {
  const ph = phaseAt(now, c);
  if (ph === 'night') return true;
  if (ph !== 'after') return false;
  const l = localParts(now, c.timezone);
  return (l.hour === 7 || l.hour === 19) && l.minuteOfHour < 10;
}
