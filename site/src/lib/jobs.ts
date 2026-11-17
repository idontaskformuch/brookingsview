/** Shared jobs logic: category slugging, salary display, and the employer
 *  diversity cap -- used by both the existing /jobs listing page and the
 *  new /jobs/category/<slug>/ landing pages (see NEEDS-HUMAN-REVIEW.md,
 *  "Week 4 -- Jobs Landing Pages") so they never compute the same facts
 *  two different ways.
 */
import type { Job } from './db';
import { countryProfile, type CountryId } from './country-profile';

/** The one name every page that cites this source should use -- matches
 *  jobs.astro's own attribution link text exactly. Single shared constant
 *  so Month in Review's own attribution can never drift from the listing
 *  page's wording. */
export const JOBS_SOURCE_NAME = 'Adzuna';

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

/** Adzuna's label for a category we also name ourselves (scrapers/parsers/jobs_v1.py _ADZUNA_LABEL_ALIASES): one category, one page
 *  (P6-10, 2026-11-16 -- Moreno had both /jobs/category/healthcare-nursing/ and /healthcare-nursing-jobs/). Rows stored before the
 *  parser fix keep the Adzuna label, so the site maps on read. Mirrored in astro.config.mjs; jobs.test.ts compares all three copies. */
export const JOB_CATEGORY_ALIASES: Record<string, string> = {
  'Healthcare & Nursing Jobs': 'Healthcare & Nursing',
  'Logistics & Warehouse Jobs': 'Warehouse & Logistics',
  'Retail Jobs': 'Retail',
  'Customer Services Jobs': 'Customer Service',
  'Trade & Construction Jobs': 'Construction & Trades',
  'Admin Jobs': 'Administrative & Office',
};

export function canonicalJobCategory(category: string | null): string | null {
  return category === null ? null : (JOB_CATEGORY_ALIASES[category] ?? category);
}

export function slugifyCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Whole-unit money in the country's own currency and locale ($ for us, £ for gb). */
export function salaryMoney(value: number, country: CountryId | undefined): string {
  const p = countryProfile(country);
  return new Intl.NumberFormat(p.locale, { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(value);
}

export function salaryText(
  job: Pick<Job, 'salary_min' | 'salary_max' | 'salary_is_predicted'>,
  country?: CountryId,
): string {
  const { salary_min: lo, salary_max: hi, salary_is_predicted: predicted } = job;
  let range: string;
  if (lo == null && hi == null) return '—';
  else if (lo == null) range = `up to ${salaryMoney(hi as number, country)}`;
  else if (hi == null || lo === hi) range = salaryMoney(lo, country);
  else range = `${salaryMoney(lo, country)}–${salaryMoney(hi, country)}`;
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

function normaliseForKey(s: string | null): string {
  return (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Legal-form words dropped from the END of an employer name only ("CompHealth Inc." = "CompHealth"). Never a prefix match:
 *  "AMN Healthcare" and "AMN Healthcare Allied" stay two employers (audit Fas 6b, owner 2026-11-17, decision 5). */
const EMPLOYER_SUFFIXES = new Set(['inc', 'llc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'lp', 'llp']);

/** One employer however Adzuna spelled it: case, spaces, punctuation and a trailing legal form do not count
 *  ("Headway." = "Headway", "UCHealth " = "UCHealth", "CompHealth Inc." = "CompHealth"). '' when there is no company. */
export function employerKey(company: string | null): string {
  const words = normaliseForKey(company).split(' ').filter(Boolean);
  while (words.length > 1 && EMPLOYER_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** The dedupe key every /jobs/ number uses (table, hero, insight lines, category pages); null = never merged. */
export function jobKey(job: { company: string | null; title: string | null }): string | null {
  const company = employerKey(job.company);
  const title = normaliseForKey(job.title);
  return company && title ? `${company}|${title}` : null;
}

/** employerKey -> the spelling most rows in `jobs` use; a tie goes to the spelling on the newest posting (owner 2026-11-17). */
export function employerSpellings(jobs: { company: string | null; posted_at?: string | null }[]): Map<string, string> {
  const counts = new Map<string, Map<string, { n: number; newest: string }>>();
  for (const j of jobs) {
    const key = employerKey(j.company);
    if (!key || !j.company) continue;
    const spelling = j.company.trim();
    const byKey = counts.get(key) ?? new Map<string, { n: number; newest: string }>();
    const c = byKey.get(spelling) ?? { n: 0, newest: '' };
    c.n += 1;
    if ((j.posted_at ?? '') > c.newest) c.newest = j.posted_at ?? '';
    byKey.set(spelling, c);
    counts.set(key, byKey);
  }
  const out = new Map<string, string>();
  for (const [key, byKey] of counts) {
    const [best] = [...byKey.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].newest < b[1].newest ? 1 : a[1].newest > b[1].newest ? -1 : 0));
    out.set(key, best[0]);
  }
  return out;
}

/** One row per company + title (Q3 2026-10-23: dozens of identical "Earn with Uber Eats" ads filled most of the 100 slots).
 *  Keeps the newest listing (jobs arrive newest first, so the first one seen) and counts the rest in `duplicateCount`.
 *  A job with no company or no title is never merged. Company compared by employerKey(). */
export function dedupeJobs<T extends { company: string | null; title: string | null; posted_at?: string | null }>(
  jobs: T[],
): (T & { duplicateCount: number })[] {
  const seen = new Map<string, number>();
  const out: (T & { duplicateCount: number })[] = [];
  for (const job of jobs) {
    const key = jobKey(job);
    if (!key) { out.push({ ...job, duplicateCount: 1 }); continue; }
    const at = seen.get(key);
    if (at === undefined) { seen.set(key, out.length); out.push({ ...job, duplicateCount: 1 }); continue; }
    const kept = out[at];
    kept.duplicateCount += 1;
    // keep the newest posting when the feed was not strictly newest-first
    if (job.posted_at && (!kept.posted_at || job.posted_at > kept.posted_at)) out[at] = { ...job, duplicateCount: kept.duplicateCount };
  }
  return out;
}

/** Nothing is dropped: visible + every overflow list = `jobs`, so a count of `jobs` is what the page shows (audit Fas 6b, tillägg 2).
 *  overflowByCompany is keyed by employerKey(); show it through employerSpellings(). */
export function capByEmployer<T extends { company: string | null }>(
  jobs: T[],
): { visible: T[]; overflowByCompany: Map<string, T[]> } {
  const employerCap = Math.max(3, Math.ceil(jobs.length * EMPLOYER_CAP_RATIO));
  const visible: T[] = [];
  const overflowByCompany = new Map<string, T[]>();
  const seenCount = new Map<string, number>();
  for (const job of jobs) {
    const key = employerKey(job.company);
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
