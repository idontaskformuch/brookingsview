import { describe, expect, it } from 'vitest';
import { evaluateEveningThreshold, eveningNights, median } from './evening-threshold';

const TZ = 'Europe/London';
const NOW = new Date('2026-10-28T14:00:00Z'); // Wed 28 Oct 14:00 local (GMT)

/** `count` items on local evening `offset` days from today, spread over `groups` groups. */
function night(offset: number, count: number, groups: number, hour = 19) {
  const d = new Date(Date.UTC(2026, 9, 28 + offset, hour, 0));
  return Array.from({ length: count }, (_, i) => ({ start: d.toISOString(), group: `g${i % groups}` }));
}
/** The same shape on every one of the next 14 evenings. */
const every = (count: number, groups: number) => Array.from({ length: 14 }, (_, i) => night(i, count, groups)).flat();

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('eveningNights', () => {
  it('returns 14 evenings starting today and ignores daytime items', () => {
    const n = eveningNights([...night(0, 2, 1), ...night(0, 5, 1, 11)], NOW, TZ);
    expect(n).toHaveLength(14);
    expect(n[0]).toMatchObject({ items: 2, groups: 1 });
    expect(n[1].items).toBe(0);
  });
  it('starts tomorrow once it is 23:00 local', () => {
    const late = new Date('2026-10-28T23:30:00Z');
    const n = eveningNights([...night(0, 4, 1), ...night(1, 3, 1)], late, TZ);
    expect(n[0].items).toBe(3);
  });
  it('uses the town zone, not UTC, for the 17:00 cut-off (BST)', () => {
    const summer = new Date('2026-07-01T10:00:00Z');
    // 16:30Z = 17:30 BST -> evening; 15:30Z = 16:30 BST -> not.
    const n = eveningNights([{ start: '2026-07-01T16:30:00Z', group: 'a' }, { start: '2026-07-01T15:30:00Z', group: 'a' }], summer, TZ);
    expect(n[0].items).toBe(1);
  });
  it('drops items beyond the 14th evening and unparseable starts', () => {
    const n = eveningNights([...night(14, 5, 1), { start: 'nope', group: 'a' }], NOW, TZ);
    expect(n.every((x) => x.items === 0)).toBe(true);
  });
});

describe('evaluateEveningThreshold', () => {
  it('enters at 10 items in 3 groups per evening', () => {
    const v = evaluateEveningThreshold({ items: every(10, 3), now: NOW, timezone: TZ });
    expect(v).toMatchObject({ indexable: true, reason: 'enter', medianItems: 10, medianGroups: 3 });
  });
  it('does not enter at 9 items', () => {
    expect(evaluateEveningThreshold({ items: every(9, 3), now: NOW, timezone: TZ })).toMatchObject({ indexable: false, reason: 'below-items' });
  });
  it('does not enter on 2 groups however many items', () => {
    expect(evaluateEveningThreshold({ items: every(20, 2), now: NOW, timezone: TZ })).toMatchObject({ indexable: false, reason: 'below-groups' });
  });
  it('one big night cannot carry the town (median, not sum)', () => {
    const v = evaluateEveningThreshold({ items: [...night(2, 200, 5), ...every(1, 1)], now: NOW, timezone: TZ });
    expect(v.indexable).toBe(false);
    expect(v.medianItems).toBe(1);
  });
  it('hysteresis: 8 keeps an indexable town, 7 drops it, 9 does not let a new one in', () => {
    expect(evaluateEveningThreshold({ items: every(8, 3), now: NOW, timezone: TZ, previouslyIndexable: true })).toMatchObject({ indexable: true, reason: 'stay' });
    expect(evaluateEveningThreshold({ items: every(7, 3), now: NOW, timezone: TZ, previouslyIndexable: true })).toMatchObject({ indexable: false, reason: 'below-items' });
    expect(evaluateEveningThreshold({ items: every(9, 3), now: NOW, timezone: TZ, previouslyIndexable: false }).indexable).toBe(false);
  });
  it('hysteresis does not relax the group bar', () => {
    expect(evaluateEveningThreshold({ items: every(12, 2), now: NOW, timezone: TZ, previouslyIndexable: true })).toMatchObject({ indexable: false, reason: 'below-groups' });
  });
  it('mode never stays noindex whatever the data says', () => {
    expect(evaluateEveningThreshold({ items: every(30, 5), now: NOW, timezone: TZ, mode: 'never' })).toMatchObject({ indexable: false, reason: 'config' });
  });
  it('empty input is not indexable', () => {
    expect(evaluateEveningThreshold({ items: [], now: NOW, timezone: TZ }).indexable).toBe(false);
  });
});

describe('town config', () => {
  it('Brookings never indexes the evening layer; the other towns use the threshold', async () => {
    const { ALL_CONFIGS } = await import('./site-config');
    const mode = (id: string) => ALL_CONFIGS.find((c) => c.townId === id)?.eveningLayer?.mode;
    expect(mode('brookings_sd')).toBe('never');
    for (const t of ['moreno_valley_ca', 'broomfield_co', 'glasgow']) expect(mode(t)).toBe('threshold');
  });
});
