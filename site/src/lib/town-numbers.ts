/** "<Town> in numbers" (Fas 4, specs/full-pages-no-ai-prose.md, owner decisions D1-D5 2026-11-19 = "Beslut 7"): the pure part.
 *  No DB here: lib/town-numbers-data.ts loads the rows, components/rail/RailNumbers.astro renders.
 *
 *  Weeks are the town's local calendar weeks, Monday first. A "full week" has ended; the current week never counts.
 *  D1: a line only when the source covers all NUMBERS_WEEKS full weeks; otherwise the number alone. A week is covered when the source
 *      had a successful read in it, and the week starts after the week of the source's first read (that first week is partial).
 *      For counts built from published stories (events) a week with 0 rows is also uncovered: Moreno Valley's events scraper read
 *      every week of August 2026 (scrape_runs ok, ~1000 items a read) yet no published event occurs in 3 Aug-6 Sep, so a read alone
 *      does not show the week was covered (owner: "Morenos evenemang i augusti ... ingen linje förrän luckan har passerat").
 *  D2: one line per number, and a number without a line looks like the others (ui-html sparkNumberHtml).
 *  D5: an insight line needs the same coverage as the line, at most one per number, no percentages or trend words, and "since <Month>"
 *      only when an earlier covered week really was higher (lower); a record for all the data we have gives no line. */
import { localDayNumber } from './local-day';

export const NUMBERS_WEEKS = 12;
/** Spec: "3-4 tal". At most this many rows, in NUMBER_ORDER. */
export const NUMBERS_MAX = 4;
/** Fewer rows than this and the module is not shown (a single number is not "the town in numbers"). */
export const NUMBERS_MIN = 2;
/** D4: the jobs number is hidden when the jobs source has not read successfully for this long. */
export const JOBS_READ_MAX_AGE_DAYS = 7;

export type NumberId = 'events' | 'closures' | 'jobs' | 'meetings' | 'decisions';
export const NUMBER_ORDER: NumberId[] = ['events', 'closures', 'jobs', 'meetings', 'decisions'];

const DAY_MS = 86_400_000;

/** Monday-first week index of a local day number (day 0 = Thu 1 Jan 1970, so Monday 29 Dec 1969 = day -3 starts week 0). */
export const weekOfDay = (day: number): number => Math.floor((day + 3) / 7);
export const weekStartDay = (week: number): number => week * 7 - 3;
export const weekOf = (instant: string | Date, tz: string): number => weekOfDay(localDayNumber(new Date(instant), tz));

/** The NUMBERS_WEEKS full weeks before the current local week, oldest first. */
export function fullWeeks(now: Date, tz: string): number[] {
  const current = weekOf(now, tz);
  return Array.from({ length: NUMBERS_WEEKS }, (_, i) => current - NUMBERS_WEEKS + i);
}

/** Rows per week for `weeks`. */
export function countByWeek(rowWeeks: number[], weeks: number[]): number[] {
  const n = new Map<number, number>();
  for (const w of rowWeeks) n.set(w, (n.get(w) ?? 0) + 1);
  return weeks.map((w) => n.get(w) ?? 0);
}

export interface Coverage {
  /** Week of the source's first successful read ever; null = never read. */
  firstReadWeek: number | null;
  /** Weeks with at least one successful read. */
  readWeeks: Set<number>;
  /** Stories-based counts: a week with 0 rows is not covered (see the module doc). */
  zeroIsGap?: boolean;
}

/** Counts with null for each week the source did not cover (D1: a gap is never a 0). */
export function coveredSeries(counts: number[], weeks: number[], cov: Coverage): (number | null)[] {
  return counts.map((c, i) => {
    const w = weeks[i];
    if (cov.firstReadWeek == null || w <= cov.firstReadWeek || !cov.readWeeks.has(w)) return null;
    return cov.zeroIsGap && c === 0 ? null : c;
  });
}

/** The line's values: all NUMBERS_WEEKS weeks covered, else null (number without a line). */
export function lineValues(series: (number | null)[]): number[] | null {
  return series.length === NUMBERS_WEEKS && series.every((v): v is number => v != null) ? series : null;
}

export interface InsightNouns { busiest: string; quietest: string }

/** D5. `series` = a full line (NUMBERS_WEEKS covered weeks, oldest first); the last value is the latest full week.
 *  "<busiest> since <Month>" when an earlier week was higher and every week after it, up to the latest, was lower than the latest;
 *  mirrored for "<quietest>". Ties count as not lower/higher. No line when:
 *   - the latest week is the highest (lowest) of the whole series (a record for all the data we have),
 *   - the week just before was already higher (lower) (the latest week is not the busiest of any stretch),
 *   - the earlier week falls in the latest week's own month ("since November" said in November tells the reader nothing). */
export function insightLine(series: number[], weeks: number[], nouns: InsightNouns, locale: string): string | null {
  if (series.length !== NUMBERS_WEEKS || weeks.length !== NUMBERS_WEEKS) return null;
  const last = series.length - 1;
  const L = series[last];
  const prev = series[last - 1];
  const side = L > prev ? 'busiest' : L < prev ? 'quietest' : null;
  if (side === null) return null;
  const beyond = (v: number) => (side === 'busiest' ? v > L : v < L);
  const inside = (v: number) => (side === 'busiest' ? v < L : v > L);
  let j = last - 1;
  while (j >= 0 && inside(series[j])) j -= 1;
  if (j < 0 || !beyond(series[j])) return null; // a record for all the data, or a tie stopped the stretch
  const month = monthName(weekStartDay(weeks[j]), locale);
  if (month === monthName(weekStartDay(weeks[last]), locale)) return null;
  return `${nouns[side]} since ${month}`;
}

const monthName = (day: number, locale: string) =>
  new Date(day * DAY_MS).toLocaleString(locale, { month: 'long', timeZone: 'UTC' });

/** Month name of the local month before `now` and its { y, m }. */
export function lastFullMonth(now: Date, tz: string, locale: string): { y: number; m: number; name: string } {
  const day = localDayNumber(now, tz);
  const d = new Date(day * DAY_MS);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return { y, m, name: new Date(Date.UTC(y, m - 1, 1)).toLocaleString(locale, { month: 'long', timeZone: 'UTC' }) };
}

export interface NumberRow {
  id: NumberId;
  label: string;
  value: number;
  href: string;
  /** The line (D1/D2), or null for the number alone. */
  line: number[] | null;
  /** What the line shows, for its text alternative. */
  span: string | null;
  insight: string | null;
}

/** Rows in NUMBER_ORDER, at most NUMBERS_MAX; [] when fewer than NUMBERS_MIN (the module is hidden). */
export function pickRows(rows: (NumberRow | null)[]): NumberRow[] {
  const byId = new Map(rows.filter((r): r is NumberRow => r !== null).map((r) => [r.id, r]));
  const out = NUMBER_ORDER.map((id) => byId.get(id)).filter((r): r is NumberRow => r !== undefined).slice(0, NUMBERS_MAX);
  return out.length >= NUMBERS_MIN ? out : [];
}

export const INSIGHT_NOUNS: Record<'events' | 'closures' | 'jobs', InsightNouns> = {
  events: { busiest: 'Busiest event week', quietest: 'Quietest event week' },
  closures: { busiest: 'Most road closures in a week', quietest: 'Fewest road closures in a week' },
  jobs: { busiest: 'Most new job listings in a week', quietest: 'Fewest new job listings in a week' },
};

/** A weekly number: its line and insight under D1/D5. `trend: false` (config) keeps the number and drops line and insight. */
export function weeklyRow(o: {
  id: 'events' | 'closures' | 'jobs'; label: string; value: number; href: string; span: string;
  series: (number | null)[]; weeks: number[]; trend: boolean; locale: string;
}): NumberRow {
  const line = o.trend ? lineValues(o.series) : null;
  return {
    id: o.id, label: o.label, value: o.value, href: o.href,
    line, span: line ? o.span : null,
    insight: line ? insightLine(line, o.weeks, INSIGHT_NOUNS[o.id], o.locale) : null,
  };
}

/** Closures: the weeks a closure was listed in, from its first read (created_at) to its last (last_seen_at). */
export function closureWeekSpans(rows: { created_at: string | Date; last_seen_at: string | Date }[], tz: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const a = weekOf(r.created_at, tz);
    const b = weekOf(r.last_seen_at, tz);
    for (let w = a; w <= b; w += 1) out.push(w);
  }
  return out;
}

/** Whether `instant` (a successful read) is within `days` of `now`. */
export const readWithin = (instant: string | Date | null, now: Date, days: number): boolean =>
  instant != null && now.getTime() - new Date(instant).getTime() <= days * DAY_MS;
