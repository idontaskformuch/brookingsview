import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capByEmployer, dedupeJobs } from './jobs';
import {
  firstPostedByKey, newJobCount, jobsHero, jobsTable, jobsCategoryLine, jobsSalaryLine, statedPay,
  JOBS_HERO_MIN_NEW, JOBS_SALARY_MIN_STATED, JOBS_TABLE_ROWS,
} from './jobs-hero';

// Real rows from the jobs table, read 2026-11-17 (SELECT only). Fields copied as stored.
const R = {
  10176: { town_id: 'brookings_sd', title: 'Field Research Intern', company: 'CHS Inc', category: 'Scientific & QA Jobs', salary_min: 34780.72, salary_max: 34780.72, salary_is_predicted: true, posted_at: '2026-11-16T03:26:52Z' },
  10166: { town_id: 'brookings_sd', title: 'Traveling Registered Nurse', company: 'Solutions by Sanford', category: 'Healthcare & Nursing', salary_min: 108773.29, salary_max: 108773.29, salary_is_predicted: true, posted_at: '2026-11-15T19:06:28Z' },
  2248: { town_id: 'brookings_sd', title: 'Traveling Registered Nurse', company: 'Solutions by Sanford', posted_at: '2026-08-20T02:01:23Z' },
  10151: { town_id: 'brookings_sd', title: 'Driver Helper', company: 'United Parcel Service', category: 'Transportation & Driving', salary_min: 38272, salary_max: 38272, salary_is_predicted: false, posted_at: '2026-11-15T23:06:22Z' },
  7920: { town_id: 'brookings_sd', title: 'Driver Helper', company: 'United Parcel Service', posted_at: '2026-10-27T17:41:12Z' },
  10125: { town_id: 'broomfield_co', title: 'Driver Helper', company: 'United Parcel Service', category: 'Transportation & Driving', salary_min: 38272, salary_max: 38272, salary_is_predicted: false, posted_at: '2026-11-15T23:07:09Z' },
  8283: { town_id: 'broomfield_co', title: 'Driver Helper', company: 'United Parcel Service', posted_at: '2026-10-31T11:12:33Z' },
  9976: { town_id: 'broomfield_co', title: 'Ultrasound Technician / Sonographer - Part-time mornings', company: 'Everleap Fertility', category: 'Part time Jobs', salary_min: 83200, salary_max: 104000, salary_is_predicted: false, posted_at: '2026-11-14T08:28:09Z' },
  10075: { town_id: 'moreno_valley_ca', title: 'Local Contract Nurse RN - ED - Emergency Department - $60-64 per hour', company: 'Host Healthcare', category: 'Healthcare & Nursing', salary_min: 124800, salary_max: 133120, salary_is_predicted: false, posted_at: '2026-11-11T21:04:19Z' },
  9948: { town_id: 'moreno_valley_ca', title: 'Chain Sales Merchandiser (Golden State) - Riverside (Riverside)', company: "Southern Glazer's Wine & Spirits", category: 'Sales Jobs', salary_min: 49092.16, salary_max: 49092.16, salary_is_predicted: true, posted_at: '2026-11-14T02:04:47Z' },
} as const;
const NOW = new Date('2026-11-17T06:00:00Z');

describe('firstPostedByKey / newJobCount (decision 1 + tillägg 1)', () => {
  it('a repost of an older ad is not new; a first posting inside 7 days is', () => {
    const first = firstPostedByKey([R[10176], R[10166], R[2248]], 'brookings_sd');
    expect(first.get('solutions by sanford|traveling registered nurse')).toBe(Date.parse(R[2248].posted_at));
    expect(newJobCount(first, NOW)).toBe(1); // only 10176 CHS Inc "Field Research Intern"
  });
  it('the same employer + title in two cities: each city has its own first posting', () => {
    const rows = [R[10151], R[7920], R[10125], R[8283]];
    const brookings = firstPostedByKey(rows, 'brookings_sd');
    const broomfield = firstPostedByKey(rows, 'broomfield_co');
    expect(brookings.get('united parcel service|driver helper')).toBe(Date.parse(R[7920].posted_at));
    expect(broomfield.get('united parcel service|driver helper')).toBe(Date.parse(R[8283].posted_at));
    // 6 Nov: within 7 days of Broomfield's 31 Oct first posting, not of Brookings' 27 Oct one
    const nov6 = new Date('2026-11-06T00:00:00Z');
    expect(newJobCount(broomfield, nov6)).toBe(1);
    expect(newJobCount(brookings, nov6)).toBe(0);
  });
  it('uses the dedupe key: a legal-form spelling of the same employer is the same pair', () => {
    // real row 10176 with only company changed ("CHS Inc" -> "CHS Inc."), as Brookings has both spellings
    const first = firstPostedByKey([R[10176], { ...R[10176], company: 'CHS Inc.', posted_at: '2026-09-01T00:00:00Z' }], 'brookings_sd');
    expect(first.size).toBe(1);
    expect(newJobCount(first, NOW)).toBe(0);
  });
});

describe('jobsHero (threshold JOBS_HERO_MIN_NEW)', () => {
  it('no hero below the threshold (Brookings 17 Nov: 4 new)', () => {
    expect(JOBS_HERO_MIN_NEW).toBe(5);
    expect(jobsHero(4, 177)).toBeNull();
  });
  it('from the threshold: count, the 45-day denominator, and that reposts are left out -- never "open"', () => {
    const h = jobsHero(5, 347)!;
    expect(h).toEqual({ value: '5', unit: 'new in the last 7 days', sub: '347 listings posted in the last 45 days', meta: 'Reposts of earlier listings are not counted' });
    expect(JSON.stringify(h)).not.toMatch(/\bopen\b/i);
  });
});

describe('jobsTable (decision 7: dedupe before the 100 rows)', () => {
  // real row 10176 with only the title changed (101 distinct titles), then 5 copies of real row 10151
  const distinct = Array.from({ length: JOBS_TABLE_ROWS + 1 }, (_, i) => ({ ...R[10176], title: `Field Research Intern ${i}` }));
  const window = [...Array.from({ length: 5 }, () => R[10151]), ...distinct];
  it('100 rows after dedupe even when the newest raw rows are duplicates', () => {
    const { rows, countLabel } = jobsTable(dedupeJobs(window));
    expect(rows).toHaveLength(JOBS_TABLE_ROWS);
    expect(countLabel).toBe('100 newest of 102 listings');
  });
  it('the old order (100 raw rows, then dedupe) showed fewer -- the bug this replaces', () => {
    expect(dedupeJobs(window.slice(0, JOBS_TABLE_ROWS))).toHaveLength(96);
  });
  it('a window that fits says just the count', () => {
    expect(jobsTable(dedupeJobs([R[10151], R[10176]])).countLabel).toBe('2 listings');
  });
  it('every row counted is on the page: visible + folded "more from X" = rows (tillägg 2)', () => {
    // real Broomfield spellings "UCHealth" (9865) and "UCHealth " (7500) are one employer; 8 rows -> cap 3
    const uc = Array.from({ length: 8 }, (_, i) => ({ company: i % 2 ? 'UCHealth ' : 'UCHealth', title: `RN ${i}` }));
    const { rows, countLabel } = jobsTable(dedupeJobs([...uc, R[10125]]));
    const { visible, overflowByCompany } = capByEmployer(rows);
    const folded = [...overflowByCompany.values()].reduce((n, l) => n + l.length, 0);
    expect(visible.length + folded).toBe(rows.length);
    expect(countLabel).toBe(`${rows.length} listings`);
    expect(overflowByCompany.size).toBe(1);
  });
  it('jobs.astro reads the whole window and dedupes before jobsTable; getJobsInWindow has no LIMIT', () => {
    const page = readFileSync(new URL('../pages/jobs.astro', import.meta.url), 'utf8');
    expect(page).not.toMatch(/import[^;]*getRecentJobs/);
    expect(page.indexOf('dedupeJobs(windowJobs)')).toBeGreaterThan(-1);
    expect(page.indexOf('dedupeJobs(windowJobs)')).toBeLessThan(page.indexOf('jobsTable(deduped)'));
    const db = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
    const fn = db.slice(db.indexOf('export async function getJobsInWindow'), db.indexOf('export async function getJobFirstPostings'));
    expect(fn).not.toMatch(/LIMIT/i);
  });
});

describe('jobsCategoryLine (decision 2)', () => {
  it('largest category with its denominator; the category page gets exactly that many', () => {
    const deduped = dedupeJobs([R[10166], R[10075], R[10151], R[9976]]);
    const line = jobsCategoryLine(deduped)!;
    expect(line).toEqual({ category: 'Healthcare & Nursing', slug: 'healthcare-nursing', count: 2, total: 4 });
    expect(deduped.filter((j) => j.category === line.category)).toHaveLength(line.count); // what [category].astro is handed
  });
  it('no line on a tie', () => {
    // Brookings 10154 = 10151 with title "Seasonal Support Driver" (same employer, same category)
    expect(jobsCategoryLine(dedupeJobs([R[10166], R[10075], R[10151], { ...R[10151], title: 'Seasonal Support Driver' }]))).toBeNull();
  });
  it('no line below JOBS_CATEGORY_MIN_ROWS', () => {
    expect(jobsCategoryLine([R[10166]])).toBeNull();
  });
});

describe('jobsSalaryLine (decision 4)', () => {
  it('only an employer-stated salary counts; one number per listing (middle of the range)', () => {
    expect(statedPay(R[10075])).toBe(128960); // "$60-64 per hour" stored by Adzuna as 124800-133120 a year
    expect(statedPay(R[10151])).toBe(38272);
    expect(statedPay(R[9948])).toBeNull(); // predicted
  });
  // real stated rows repeated: 10151 x3, 10125 x2 (38272), 9976 x3 (93600), 10075 x2 (128960)
  const ten = [R[10151], R[10151], R[10151], R[10125], R[10125], R[9976], R[9976], R[9976], R[10075], R[10075]];
  it('25th-75th percentile, rounded to 1,000, with the count and the hourly note', () => {
    expect(JOBS_SALARY_MIN_STATED).toBe(10);
    expect(jobsSalaryLine(ten)).toEqual({
      text: 'Stated pay, middle half: $38,000–$94,000 a year · 10 listings that state a salary',
      note: 'Hourly pay converted to a full-time year',
      count: 10,
    });
  });
  it('no line under 10 stated salaries; predicted ones do not help', () => {
    expect(jobsSalaryLine([...ten.slice(1), R[9948], R[10166], R[10176]])).toBeNull();
  });
});
