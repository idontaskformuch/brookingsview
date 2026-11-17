/** /jobs/ top block (audit Fas 6b, owner 2026-11-17; decisions in .claude/notes/jobs-6b-underlag-2026-11-17.md). Built only from jobs
 *  fields; every line has a rule and a threshold (exported) and is left out when its rule does not fire. No employer line (decision 3).
 *
 *  One key everywhere: jobKey() (employer by employerKey(), title by case/punctuation). The page dedupes the whole 45-day window first,
 *  then takes its table rows, so the table, the hero, the insight lines and the category pages count the same listings (decision 7).
 *  Wording says "posted", never "open": nothing in Adzuna's data says a listing is still open (decision 6). */
import type { CountryId } from './country-profile';
import { jobKey, salaryMoney, slugifyCategory } from './jobs';

/** Rows in the /jobs/ table: the newest this many after dedupe. */
export const JOBS_TABLE_ROWS = 100;
/** The hero counts employer + title pairs first posted within this many days. */
export const JOBS_HERO_DAYS = 7;
/** ...and is shown only from this many (decision 1). */
export const JOBS_HERO_MIN_NEW = 5;
/** "Largest category" needs at least this many listings, and strictly more than any other category. */
export const JOBS_CATEGORY_MIN_ROWS = 2;
/** The pay line needs this many listings with an employer-stated (not predicted) salary (decision 4). */
export const JOBS_SALARY_MIN_STATED = 10;

const ms = (v: string | Date) => new Date(v).getTime();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

type FirstRow = { town_id: string; company: string | null; title: string | null; posted_at: string | Date | null };

/** jobKey -> earliest posted_at (ms) in this town. Rows from another town are ignored: the same ad posted in two cities is new in
 *  each city on its own date (tillägg 1). Rows without a key (no company or title) are never merged and never counted. */
export function firstPostedByKey(rows: FirstRow[], townId: string): Map<string, number> {
  const first = new Map<string, number>();
  for (const r of rows) {
    if (r.town_id !== townId || r.posted_at == null) continue;
    const k = jobKey(r);
    if (k == null) continue;
    const t = ms(r.posted_at);
    const prev = first.get(k);
    if (prev === undefined || t < prev) first.set(k, t);
  }
  return first;
}

/** Employer + title pairs whose first posting in this town is within JOBS_HERO_DAYS of `now`. A repost of an older ad is not new. */
export function newJobCount(first: Map<string, number>, now: Date): number {
  const from = now.getTime() - JOBS_HERO_DAYS * 86_400_000;
  let n = 0;
  for (const t of first.values()) if (t >= from) n += 1;
  return n;
}

export interface JobsHero { value: string; unit: string; sub: string; meta: string }

/** null below JOBS_HERO_MIN_NEW. `windowCount` = listings after dedupe in the 45-day window. */
export function jobsHero(newCount: number, windowCount: number): JobsHero | null {
  if (newCount < JOBS_HERO_MIN_NEW) return null;
  return {
    value: String(newCount),
    unit: 'new in the last 7 days',
    sub: `${plural(windowCount, 'listing')} posted in the last 45 days`,
    meta: 'Reposts of earlier listings are not counted',
  };
}

/** The table rows and the count line over it. Every row in `rows` is on the page (capByEmployer only folds some away), so the count
 *  line is rows.length, never more (tillägg 2). */
export function jobsTable<T>(deduped: T[]): { rows: T[]; countLabel: string } {
  const rows = deduped.slice(0, JOBS_TABLE_ROWS);
  const countLabel = deduped.length > rows.length ? `${rows.length} newest of ${plural(deduped.length, 'listing')}` : plural(rows.length, 'listing');
  return { rows, countLabel };
}

/** "Healthcare & Nursing: 204 of 347 listings posted in the last 45 days" -- the largest category in the deduped window, with the
 *  denominator (decision 2). The category page lists exactly those `count` listings. null on a tie or below JOBS_CATEGORY_MIN_ROWS. */
export function jobsCategoryLine(deduped: { category: string | null }[]): { category: string; slug: string; count: number; total: number } | null {
  const counts = new Map<string, number>();
  for (const j of deduped) if (j.category) counts.set(j.category, (counts.get(j.category) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const [[category, count], second] = sorted;
  if (count < JOBS_CATEGORY_MIN_ROWS || (second && second[1] === count)) return null;
  return { category, slug: slugifyCategory(category), count, total: deduped.length };
}

/** Linear interpolation between the two nearest ranks (the usual spreadsheet PERCENTILE). */
export function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

type PayRow = { salary_min: number | string | null; salary_max: number | string | null; salary_is_predicted: boolean | null };

/** One number per listing: the middle of its stated range, or the one end it gives. null for a predicted or missing salary. */
export function statedPay(j: PayRow): number | null {
  if (j.salary_is_predicted !== false) return null;
  const lo = j.salary_min == null ? null : Number(j.salary_min);
  const hi = j.salary_max == null ? null : Number(j.salary_max);
  if (lo == null && hi == null) return null;
  return ((lo ?? hi)! + (hi ?? lo)!) / 2;
}

/** "Stated pay, middle half: $97,000–$124,000 a year · 138 listings that state a salary": 25th-75th percentile of statedPay over the
 *  deduped window, rounded to the nearest 1,000 (decision 4). Adzuna gives every salary as a year (hourly x full time), hence the note. */
export function jobsSalaryLine(deduped: PayRow[], country?: CountryId): { text: string; note: string; count: number } | null {
  const pay = deduped.map(statedPay).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (pay.length < JOBS_SALARY_MIN_STATED) return null;
  const round = (v: number) => Math.round(v / 1000) * 1000;
  const lo = round(percentile(pay, 0.25));
  const hi = round(percentile(pay, 0.75));
  const range = lo === hi ? salaryMoney(lo, country) : `${salaryMoney(lo, country)}–${salaryMoney(hi, country)}`;
  return {
    text: `Stated pay, middle half: ${range} a year · ${pay.length} listings that state a salary`,
    note: 'Hourly pay converted to a full-time year',
    count: pay.length,
  };
}
