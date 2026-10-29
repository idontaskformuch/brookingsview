import { describe, it, expect } from 'vitest';
import { decideEveningIndexing } from './evening-verdict';

const tz = 'Europe/London';
const now = new Date('2026-10-29T10:00:00Z');
// 14 evenings from 2026-10-30, each with `n` items in `g` groups
const items = (n: number, g: number) => Array.from({ length: 14 }, (_, d) => Array.from({ length: n }, (_x, i) => ({
  start: new Date(Date.UTC(2026, 9, 30 + d, 19, i)).toISOString(), group: `G${i % g}`,
}))).flat();
const base = { now, timezone: tz, mode: 'threshold' as const, previouslyIndexable: false };

describe('decideEveningIndexing', () => {
  it('indexable only with BOTH the threshold and the owner approval', () => {
    expect(decideEveningIndexing({ ...base, items: items(8, 4), approved: true }).indexable).toBe(true);
    expect(decideEveningIndexing({ ...base, items: items(8, 4), approved: false }).indexable).toBe(false);
    expect(decideEveningIndexing({ ...base, items: items(3, 2), approved: true }).indexable).toBe(false);
  });
  it('never mode is never indexable, approved or not', () => {
    expect(decideEveningIndexing({ ...base, mode: 'never', items: items(8, 4), approved: true }).indexable).toBe(false);
  });
  it('hysteresis: 5 items stay in when previously indexed, do not get in', () => {
    expect(decideEveningIndexing({ ...base, items: items(5, 3), approved: true, previouslyIndexable: false }).indexable).toBe(false);
    expect(decideEveningIndexing({ ...base, items: items(5, 3), approved: true, previouslyIndexable: true }).indexable).toBe(true);
  });
});
