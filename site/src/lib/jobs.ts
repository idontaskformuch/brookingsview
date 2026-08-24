/** Shared jobs logic: category slugging, salary display, and the employer
 *  diversity cap -- used by both the existing /jobs listing page and the
 *  new /jobs/category/<slug>/ landing pages (see NEEDS-HUMAN-REVIEW.md,
 *  "Week 4 -- Jobs Landing Pages") so they never compute the same facts
 *  two different ways.
 */
import { formatPrice, type Job } from './db';

export function slugifyCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function salaryText(job: Pick<Job, 'salary_min' | 'salary_max' | 'salary_is_predicted'>): string {
  const { salary_min: lo, salary_max: hi, salary_is_predicted: predicted } = job;
  let range: string;
  if (lo == null && hi == null) return '—';
  else if (lo == null) range = `up to ${formatPrice(hi)}`;
  else if (hi == null || lo === hi) range = formatPrice(lo);
  else range = `${formatPrice(lo)}–${formatPrice(hi)}`;
  return predicted ? `${range} (est.)` : range;
}

/** A single employer (often a staffing agency) can otherwise dominate a
 *  list -- real research found one accounting for 52% of all listings.
 *  Caps a given employer's VISIBLE rows to ~30% of the list (minimum 3),
 *  moving the rest into a per-employer "more from X" overflow instead of
 *  dropping them entirely. Same logic jobs.astro already used, extracted
 *  so /jobs/category/<slug>/ applies the identical cap within its own
 *  (smaller) filtered list -- a single employer can still dominate one
 *  category even when it doesn't dominate the whole site. */
const EMPLOYER_CAP_RATIO = 0.3;

export function capByEmployer<T extends { company: string | null }>(
  jobs: T[],
): { visible: T[]; overflowByCompany: Map<string, T[]> } {
  const employerCap = Math.max(3, Math.ceil(jobs.length * EMPLOYER_CAP_RATIO));
  const visible: T[] = [];
  const overflowByCompany = new Map<string, T[]>();
  const seenCount = new Map<string, number>();
  for (const job of jobs) {
    const key = job.company ?? '';
    const count = seenCount.get(key) ?? 0;
    seenCount.set(key, count + 1);
    if (!key || count < employerCap) {
      visible.push(job);
    } else {
      if (!overflowByCompany.has(key)) overflowByCompany.set(key, []);
      overflowByCompany.get(key)!.push(job);
    }
  }
  return { visible, overflowByCompany };
}
