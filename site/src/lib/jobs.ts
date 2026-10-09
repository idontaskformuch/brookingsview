/** Shared jobs logic: category slugging, salary display, and the employer
 *  diversity cap -- used by both the existing /jobs listing page and the
 *  new /jobs/category/<slug>/ landing pages (see NEEDS-HUMAN-REVIEW.md,
 *  "Week 4 -- Jobs Landing Pages") so they never compute the same facts
 *  two different ways.
 */
import { formatPrice, type Job } from './db';

/** Jobs Phase 5 (2026-10-09): Adzuna's own location.display_name is always
 *  "<place>, <county>" (e.g. "Lake Campbell, Brookings County") -- a job in
 *  a different same-county town is real, useful context, but wasn't
 *  filterable or labeled as such before this.
 *
 *  Deliberately NOT /events' classifyLocalityByText() (lib/town-boundary.ts):
 *  that function does a substring .includes() match, which is right for a
 *  free-text venue string but actively wrong here -- "Brookings County"
 *  CONTAINS "Brookings", so every Brookings-county town (Lake Campbell,
 *  Bushnell, Volga, ...) would substring-match as "in_town", defeating the
 *  entire split. Caught by this file's own test against real stored
 *  values, not assumed safe from the event-venue precedent. Comparing only
 *  the part before the first comma, exactly, is both correct and simpler
 *  for Adzuna's own consistent format. */
export function jobZone(location: string | null, cityName: string): 'in_town' | 'nearby' {
  if (!location) return 'nearby';
  const place = location.split(',')[0]?.trim().toLowerCase();
  return place === cityName.trim().toLowerCase() ? 'in_town' : 'nearby';
}

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
