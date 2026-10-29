import { describe, expect, it } from 'vitest';
import type { EveningEntry } from './evening-items';
import { buildEveningSections, buildSection, groupEntries, pickHighlights, sectionState } from './evening-page';
import { localDayNumber } from './local-day';

const TZ = 'Europe/London';
const NOW = new Date('2026-10-28T14:00:00Z');
let n = 0;
function e(start: string, group: EveningEntry['group'], labels: EveningEntry['labels'] = []): EveningEntry {
  n += 1;
  return { id: `e${n}`, title: `T${n}`, start, end: null, group, labels, venue: null, href: null, source: 'own', distanceMiles: null, driveMinutes: null, checked: '2026-10-28' };
}

describe('pickHighlights', () => {
  it('takes the earliest of distinct groups first, then fills with the earliest rest', () => {
    const a = e('2026-10-28T19:00:00Z', 'Live music'), b = e('2026-10-28T19:30:00Z', 'Live music'), c = e('2026-10-28T20:00:00Z', 'Comedy & shows');
    const d = e('2026-10-28T18:00:00Z', null);
    expect(pickHighlights([b, a, c, d])).toEqual([d, a, c]);
  });
});

describe('groupEntries', () => {
  it('orders groups, puts free ungrouped rows under Free tonight and the rest under Also on', () => {
    const g = groupEntries([e('2026-10-28T19:00:00Z', null), e('2026-10-28T19:00:00Z', null, ['Free']), e('2026-10-28T20:00:00Z', 'Comedy & shows'), e('2026-10-28T20:00:00Z', 'Live music', ['Free'])]);
    expect(g.map((x) => x.name)).toEqual(['Live music', 'Comedy & shows', 'Free tonight', 'Also on']);
  });
  it('leaves empty groups out', () => expect(groupEntries([])).toEqual([]));
});

describe('buildEveningSections', () => {
  it('builds tonight (with highlights, not repeated in rows) and tomorrow night, ignoring daytime items', () => {
    const rows = [
      e('2026-10-28T19:00:00Z', 'Live music'), e('2026-10-28T19:30:00Z', 'Comedy & shows'), e('2026-10-28T20:00:00Z', 'Quiz & pub nights'), e('2026-10-28T21:00:00Z', 'Live music'),
      e('2026-10-28T11:00:00Z', 'Live music'), e('2026-10-29T19:00:00Z', 'Clubs & late'),
    ];
    const [tonight, tomorrow] = buildEveningSections(rows, NOW, TZ);
    expect(tonight.kind).toBe('tonight');
    expect(tonight.count).toBe(4);
    expect(tonight.highlights).toHaveLength(3);
    expect(tonight.groups.flatMap((g) => g.entries)).toHaveLength(1);
    expect(tomorrow).toMatchObject({ kind: 'tomorrow', count: 1, highlights: [] });
    expect(buildSection([], tonight.day, 'tonight', TZ, true).count).toBe(0);
  });
});

describe('sectionState', () => {
  const day = localDayNumber(NOW, TZ);
  it('shows tonight until 23:00, then hides it', () => {
    expect(sectionState(day, NOW, TZ)).toEqual({ hidden: false, kind: 'tonight' });
    expect(sectionState(day, new Date('2026-10-28T23:30:00Z'), TZ).hidden).toBe(true);
  });
  it('labels the next evening Tomorrow night, then Tonight after midnight; hides yesterday', () => {
    expect(sectionState(day + 1, NOW, TZ)).toEqual({ hidden: false, kind: 'tomorrow' });
    const next = new Date('2026-10-29T10:00:00Z');
    expect(sectionState(day + 1, next, TZ)).toEqual({ hidden: false, kind: 'tonight' });
    expect(sectionState(day, next, TZ).hidden).toBe(true);
  });
});

describe('near / further afield (owner 2026-10-29, Broomfield 5 mi)', () => {
  const at = (miles: number | null) => ({ ...e('2026-10-28T19:00:00Z', 'Live music'), distanceMiles: miles });
  it('rows within the radius (or without a distance) first, the rest in farGroups', () => {
    const s = buildSection([at(1), at(null), at(5), at(12), at(30)], localDayNumber(NOW, TZ), 'tonight', TZ, false, 5);
    expect(s.groups.flatMap((g) => g.entries).map((x) => x.distanceMiles)).toEqual([1, null, 5]);
    expect(s.farGroups.flatMap((g) => g.entries).map((x) => x.distanceMiles)).toEqual([12, 30]);
    expect(s.count).toBe(5);
  });
  it('highlights come from the near rows; no split without nearMiles', () => {
    const s = buildSection([at(30), at(1)], localDayNumber(NOW, TZ), 'tonight', TZ, true, 5);
    expect(s.highlights.map((x) => x.distanceMiles)).toEqual([1]);
    const all = buildSection([at(30), at(1)], localDayNumber(NOW, TZ), 'tonight', TZ, false);
    expect(all.farGroups).toEqual([]);
  });
});
