import { describe, expect, it } from 'vitest';
import { slugifyCategory, salaryText, capByEmployer, jobZone, dedupeJobs } from './jobs';

describe('jobZone', () => {
  // Real stored location.display_name values (last 60 days, all 3 towns).
  it('is in_town when the location names this town', () => {
    expect(jobZone('Brookings, Brookings County', 'Brookings')).toBe('in_town');
    expect(jobZone('Moreno Valley, Riverside County', 'Moreno Valley')).toBe('in_town');
    expect(jobZone('Broomfield, Colorado', 'Broomfield')).toBe('in_town');
  });

  it('is nearby for a real same-county town that is not this one', () => {
    expect(jobZone('Lake Campbell, Brookings County', 'Brookings')).toBe('nearby');
    expect(jobZone('Perris, Riverside County', 'Moreno Valley')).toBe('nearby');
    expect(jobZone('Northglenn, Adams County', 'Broomfield')).toBe('nearby');
  });

  it('is nearby (not in_town) for a null location -- never the benefit of the doubt', () => {
    expect(jobZone(null, 'Brookings')).toBe('nearby');
  });
});

describe('slugifyCategory', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyCategory('Healthcare & Nursing Jobs')).toBe('healthcare-nursing-jobs');
  });
  it('collapses repeated punctuation', () => {
    expect(slugifyCategory('Warehouse & Logistics')).toBe('warehouse-logistics');
  });
});

describe('salaryText', () => {
  it('formats a real range with commas', () => {
    expect(salaryText({ salary_min: 100000, salary_max: 135000, salary_is_predicted: false })).toBe('$100,000–$135,000');
  });
  it('marks a predicted estimate', () => {
    expect(salaryText({ salary_min: 77772, salary_max: 77772, salary_is_predicted: true })).toBe('$77,772 (est.)');
  });
  it('handles a one-sided "up to" range', () => {
    expect(salaryText({ salary_min: null, salary_max: 45000, salary_is_predicted: false })).toBe('up to $45,000');
    // UK towns: pounds, never dollars (Adzuna gb returns GBP)
    expect(salaryText({ salary_min: 38000, salary_max: 42000, salary_is_predicted: false }, 'gb')).toBe('£38,000–£42,000');
    expect(salaryText({ salary_min: 45719, salary_max: 45719, salary_is_predicted: true }, 'gb')).toBe('£45,719 (est.)');
  });
  it('handles no salary data at all', () => {
    expect(salaryText({ salary_min: null, salary_max: null, salary_is_predicted: false })).toBe('—');
  });
});

describe('capByEmployer', () => {
  it('caps a dominant employer and moves the rest to overflow', () => {
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => ({ company: 'BigStaffCo', title: `Job ${i}` })),
      { company: 'SmallCo', title: 'Other job' },
    ];
    const { visible, overflowByCompany } = capByEmployer(jobs);
    // cap = max(3, ceil(9 * 0.3)) = 3
    expect(visible.filter((j) => j.company === 'BigStaffCo')).toHaveLength(3);
    expect(overflowByCompany.get('BigStaffCo')).toHaveLength(5);
    expect(visible.filter((j) => j.company === 'SmallCo')).toHaveLength(1);
  });

  it('does not cap when no employer dominates', () => {
    const jobs = [
      { company: 'A', title: '1' }, { company: 'B', title: '2' }, { company: 'C', title: '3' },
    ];
    const { visible, overflowByCompany } = capByEmployer(jobs);
    expect(visible).toHaveLength(3);
    expect(overflowByCompany.size).toBe(0);
  });
});

describe('dedupeJobs (Q3 2026-10-23: identical Uber Eats ads filled most of the page)', () => {
  const job = (company: string | null, title: string | null, posted_at: string | null = '2026-10-07') => ({ company, title, posted_at });
  it('merges identical company + title, ignoring case and punctuation, and counts them', () => {
    const out = dedupeJobs([job('Uber Eats', 'Earn with Uber Eats, cash out up to 6x a day'), job('UBER EATS', 'earn with uber eats cash out up to 6x a day'), job('Uber Eats', 'Earn with Uber Eats, cash out up to 6x a day'), job('Costco', 'Cashier')]);
    expect(out.map((j) => [j.company, j.duplicateCount])).toEqual([['Uber Eats', 3], ['Costco', 1]]);
  });
  it('keeps the newest posting', () => {
    const out = dedupeJobs([job('A', 'Driver', '2026-10-01'), job('A', 'Driver', '2026-10-09')]);
    expect(out).toHaveLength(1);
    expect(out[0].posted_at).toBe('2026-10-09');
  });
  it('never merges a job with no company or no title, nor different titles', () => {
    expect(dedupeJobs([job(null, 'Driver'), job(null, 'Driver'), job('A', null), job('A', null), job('A', 'Driver'), job('A', 'Driver II')])).toHaveLength(6);
  });
});
