import { describe, it, expect } from 'vitest';
import { applyEveningInertia, decideEveningIndexing, type EveningState } from './evening-verdict';

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

describe('inertia (owner 2026-11-15): an indexed page goes noindex after >= 72 h and >= 3 builds below the exit bar', () => {
  /** Runs builds in order, each reading the state the previous one published (null = the read failed). */
  function run(builds: { at: string; below: boolean; readFails?: boolean }[], wasIndexed = true) {
    let state: EveningState | null = null;
    let indexed = wasIndexed;
    return builds.map((b) => {
      const r = applyEveningInertia({ townId: 'glasgow', thresholdIndexable: !b.below, wasIndexed: indexed, state: b.readFails ? null : state, now: new Date(b.at) });
      state = r.state;
      indexed = r.indexable;
      return r;
    });
  }
  // The Glasgow builds of 8-9 Nov 2026 (scratch_tmp build logs, UTC; every one "below-groups", median groups 1.5-2), then two more days.
  const below = ['2026-11-08T06:24:00Z', '2026-11-08T14:00:00Z', '2026-11-08T17:01:00Z', '2026-11-08T20:20:00Z', '2026-11-08T21:22:00Z',
    '2026-11-08T22:28:00Z', '2026-11-09T06:36:00Z', '2026-11-09T07:26:00Z', '2026-11-09T08:21:00Z', '2026-11-10T11:00:00Z',
    '2026-11-11T06:23:00Z', '2026-11-11T06:24:00Z', '2026-11-11T11:00:00Z'].map((at) => ({ at, below: true }));

  it('8-9 Nov: indexed through every build until 72 h after the first one below, then noindex', () => {
    const r = run(below);
    expect(r.map((x) => x.indexable)).toEqual([true, true, true, true, true, true, true, true, true, true, true, false, false]);
    expect(r[0]).toMatchObject({ hoursLeft: 72, buildsLeft: 2, state: { belowSince: '2026-11-08T06:24:00.000Z', belowBuilds: 1 } });
    expect(r[10].hoursLeft).toBeCloseTo(1 / 60, 5);
  });

  it('72 h are not enough without 3 builds', () => {
    expect(run([{ at: '2026-11-08T06:24:00Z', below: true }, { at: '2026-11-12T06:24:00Z', below: true }, { at: '2026-11-12T07:00:00Z', below: true }])
      .map((x) => x.indexable)).toEqual([true, true, false]);
  });

  it('one build above the bar starts over', () => {
    const r = run([...below.slice(0, 9), { at: '2026-11-10T11:00:00Z', below: false }, ...below.slice(10)]);
    expect(r[9]).toMatchObject({ indexable: true, state: { belowSince: null, belowBuilds: 0 } });
    expect(r.slice(10).every((x) => x.indexable)).toBe(true);
    expect(r[10].state.belowSince).toBe('2026-11-11T06:23:00.000Z');
  });

  it('a failed read starts over and never drops the page on that build', () => {
    const r = run([...below.slice(0, 11), { at: '2026-11-11T06:24:00Z', below: true, readFails: true }]);
    expect(r[11]).toMatchObject({ indexable: true, hoursLeft: 72, state: { belowSince: '2026-11-11T06:24:00.000Z', belowBuilds: 1 } });
  });

  it('a page that is not indexed follows the verdict at once, and the state of another town is not used', () => {
    expect(run([{ at: '2026-11-08T06:24:00Z', below: true }], false)[0]).toMatchObject({ indexable: false, hoursLeft: null });
    const other = applyEveningInertia({ townId: 'glasgow', thresholdIndexable: false, wasIndexed: true, now: new Date('2026-11-11T07:00:00Z'),
      state: { townId: 'broomfield_co', belowSince: '2026-11-01T00:00:00Z', belowBuilds: 9 } });
    expect(other).toMatchObject({ indexable: true, state: { belowBuilds: 1 } });
  });

  it('decideEveningIndexing holds an indexed page below the bar, and never without the owner approval', () => {
    const state = { townId: 'glasgow', belowSince: '2026-10-28T09:00:00Z', belowBuilds: 1 };
    expect(decideEveningIndexing({ ...base, items: items(4, 3), approved: true, previouslyIndexable: true, townId: 'glasgow', state })).toMatchObject({
      indexable: true, verdict: { indexable: false, reason: 'below-items' }, inertia: { state: { belowBuilds: 2 } },
    });
    expect(decideEveningIndexing({ ...base, items: items(4, 3), approved: false, previouslyIndexable: true, townId: 'glasgow', state }).indexable).toBe(false);
  });
});
