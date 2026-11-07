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

/** Hours beyond 24:00 on the same line mean "after midnight" ("11:00-25:00" closes at 01:00), believed only up to 06:00 like an overnight range. */
const MAX_HOUR = 30;

function minutes(t: string): number | null {
  const [h, m] = t.split(':').map(Number);
  if (m > 59 || h > MAX_HOUR) return null;
  if (h >= 24 && h * 60 + m > 1440 + MAX_OVERNIGHT_END_MIN) return null;
  return h * 60 + m;
}

function rangesOf(spec: string): HoursRange[] | null {
  const out: HoursRange[] = [];
  for (const part of spec.split(',')) {
    const m = RANGE_RE.exec(part.trim());
    if (!m) return null;
    const start = minutes(m[1]);
    let end = minutes(m[2]);
    if (start === null || end === null || start >= 1440) return null;
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

/** Two ranges of the same day that touch or overlap become one ("Th-Su 16:00-22:00, Fr,Sa 16:00-22:30" -> Friday 16:00-22:30). */
function union(ranges: HoursRange[]): HoursRange[] {
  const sorted = [...ranges].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: HoursRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAY_LIST_RE = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*) (.+)$`);

/** What the string says. `week` is an exact reading; `closed` is "closed"/"off" for the whole place; `untimed` is a place whose hours we
 *  deliberately do not turn into times (an open end "11:00+", a free-text comment, public/school holiday rules): show it without a time, never
 *  guess one; `unparsed` is anything else outside the supported subset. */
export type HoursParse =
  | { kind: 'week'; week: WeekHours }
  | { kind: 'closed' }
  | { kind: 'untimed'; reason: 'open-end' | 'comment' | 'holiday' }
  | { kind: 'unparsed' };

/** OSM semantics: ";" starts a rule that overrides the days it names; "," between rules ("Su-Th 12:00-23:00, Fr,Sa 12:00-01:00") adds to them. */
export function parseOpeningHoursDetailed(raw: string | null | undefined): HoursParse {
  const original = (raw ?? '').trim();
  if (!original) return { kind: 'unparsed' };
  if (original === '24/7') return { kind: 'week', week: DAYS.map(() => [{ start: 0, end: 1440 }]) };
  if (/^(closed|off)$/i.test(original)) return { kind: 'closed' };
  if (/"/.test(original)) return { kind: 'untimed', reason: 'comment' };
  if (/\+/.test(original)) return { kind: 'untimed', reason: 'open-end' };
  if (/\b(PH|SH)\b/.test(original)) return { kind: 'untimed', reason: 'holiday' };
  const text = original.replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
  const week: WeekHours = DAYS.map(() => []);
  for (const rule of text.split(';')) {
    const r = rule.trim();
    if (!r) continue;
    const touched = new Set<number>();
    for (const sub of r.split(/(?<=\d|off|[Cc]losed),(?=[A-Z][a-z])/)) {
      const m = DAY_LIST_RE.exec(sub);
      const days = m ? daysOf(m[1]) : daysOf('Mo-Su');
      const timePart = m ? m[2] : sub;
      if (!days) return { kind: 'unparsed' };
      const ranges = /^(off|closed)$/i.test(timePart) ? [] : rangesOf(timePart);
      if (!ranges) return { kind: 'unparsed' };
      for (const d of days) {
        week[d] = touched.has(d) ? union([...week[d], ...ranges]) : union(ranges);
        touched.add(d);
      }
    }
  }
  return { kind: 'week', week };
}

/** The exact weekly hours, or null for everything else (the open-late block leaves such places out). */
export function parseOpeningHours(raw: string | null | undefined): WeekHours | null {
  const parsed = parseOpeningHoursDetailed(raw);
  return parsed.kind === 'week' ? parsed.week : null;
}

/** Like parseOpeningHours, but a string whose only problem is a public/school-holiday rule ("Mo-Sa 11:00-22:00; PH off") is read without that rule and
 *  flagged `holidayRule`: the weekly pattern is believed, the times are not shown (Open tonight, owner 2026-11-07). Everything else outside the subset is null. */
export function parseOpeningHoursLoose(raw: string | null | undefined): { week: WeekHours; holidayRule: boolean } | null {
  const d = parseOpeningHoursDetailed(raw);
  if (d.kind === 'week') return { week: d.week, holidayRule: false };
  if (d.kind !== 'untimed' || d.reason !== 'holiday') return null;
  const stripped = (raw ?? '').replace(/(?:^|[;,])\s*(?:PH|SH)\b[^;,]*/g, '').replace(/^\s*[;,]\s*/, '').trim();
  if (!stripped || /\b(PH|SH)\b/.test(stripped)) return null;
  const again = parseOpeningHoursDetailed(stripped);
  return again.kind === 'week' ? { week: again.week, holidayRule: true } : null;
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
