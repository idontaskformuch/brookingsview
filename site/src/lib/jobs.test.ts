import { describe, expect, it } from 'vitest';
import { slugifyCategory, salaryText, capByEmployer, jobZone } from './jobs';

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
