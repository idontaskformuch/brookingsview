/** Reads the common subset of OpenStreetMap's `opening_hours` syntax and answers one question: does this place stay open
 *  past 23:00 on a given weekday? Anything outside the subset (public holidays, months, week numbers, sunrise/sunset,
 *  "+" open ends, comments) returns null and the place is left out: a guessed time on a page about tonight is worse than
 *  a missing row. Pure functions, no I/O. Used by lib/osm-open-late.ts (evening layer, step 5). */

/** Minutes after local midnight of the day the range starts; `end` can pass 1440 for a range that runs into the next day. */
export interface HoursRange { start: number; end: number }
/** Index 0 = Monday ... 6 = Sunday. */
export type WeekHours = HoursRange[][];

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const TIME = String.raw`\d{1,2}:\d{2}`;
const RANGE_RE = new RegExp(`^(${TIME})-(${TIME})$`);
const DAY_TOKEN_RE = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/;

/** A range that runs past midnight is believed only if it ends by 06:00. */
const MAX_OVERNIGHT_END_MIN = 6 * 60;

/** Past this many minutes after midnight a place counts as "open late" (past 11 pm). */
export const OPEN_LATE_AFTER_MIN = 23 * 60;

function minutes(t: string): number | null {
  const [h, m] = t.split(':').map(Number);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

function daysOf(spec: string): number[] | null {
  const out: number[] = [];
  for (const token of spec.split(',')) {
    const m = DAY_TOKEN_RE.exec(token);
    if (!m) return null;
    const from = DAYS.indexOf(m[1]);
    const to = m[2] ? DAYS.indexOf(m[2]) : from;
    // Mo-Su and Fr-Mo: walk forward, wrapping at Sunday.
    for (let i = from; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === to) break;
    }
  }
  return out;
}

function rangesOf(spec: string): HoursRange[] | null {
  const out: HoursRange[] = [];
  for (const part of spec.split(',')) {
    const m = RANGE_RE.exec(part.trim());
    if (!m) return null;
    const start = minutes(m[1]);
    let end = minutes(m[2]);
    if (start === null || end === null) return null;
    if (end <= start) {
      // 18:00-02:00 runs past midnight. One that closes after 06:00 ("12:00-10:00", a typo for 22:00) is a mapping error, not a night: skip the place.
      if (end > MAX_OVERNIGHT_END_MIN) return null;
      end += 1440;
    }
    if (end - start >= 1440 && !(start === 0 && end === 1440)) return null;
    out.push({ start, end });
  }
  return out;
}

/** Null when the string is empty or uses anything outside the supported subset. Later rules override earlier ones for the
 *  days they name, as OSM specifies; "off" empties the day. */
export function parseOpeningHours(raw: string | null | undefined): WeekHours | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const week: WeekHours = DAYS.map(() => []);
  if (text === '24/7') return week.map(() => [{ start: 0, end: 1440 }]);
  for (const rule of text.split(';')) {
    const r = rule.trim();
    if (!r) continue;
    const space = r.search(/\s/);
    let dayPart = 'Mo-Su';
    let timePart = r;
    if (space !== -1 && /^[A-Z]/.test(r)) {
      dayPart = r.slice(0, space);
      timePart = r.slice(space + 1).trim();
    }
    const days = daysOf(dayPart);
    if (!days) return null;
    if (timePart === 'off') {
      for (const d of days) week[d] = [];
      continue;
    }
    const ranges = rangesOf(timePart);
    if (!ranges) return null;
    for (const d of days) week[d] = ranges;
  }
  return week;
}

/** The range that starts on `weekday` and ends latest, when that end is past 23:00; otherwise null. */
export function lateRange(week: WeekHours, weekday: number): HoursRange | null {
  const late = week[weekday].filter((r) => r.end > OPEN_LATE_AFTER_MIN);
  if (late.length === 0) return null;
  return late.reduce((a, b) => (b.end > a.end ? b : a));
}

/** "until midnight", "until 1am", "until 2:30am", "open 24 hours". */
export function closingLabel(r: HoursRange): string {
  if (r.start === 0 && r.end === 1440) return 'open 24 hours';
  const m = r.end % 1440;
  if (m === 0) return 'until midnight';
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `until ${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
}
