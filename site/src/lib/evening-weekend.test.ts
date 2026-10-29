import { describe, expect, it } from 'vitest';
import { buildWeekendSections, weekendDayHidden, weekendFriday, weekendGroupOf } from './evening-weekend';
import type { EveningEntry } from './evening-items';

const TZ = 'Europe/London';
const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
function entry(id: string, start: string, over: Partial<EveningEntry> = {}): EveningEntry {
  return { id, title: id, start, end: null, group: 'Live music', labels: [], venue: 'V', href: null, source: 'own', distanceMiles: null, driveMinutes: null, checked: '2026-11-02', ...over };
}

describe('weekendFriday', () => {
  it('is the coming Friday Monday to Thursday and the running weekend from Friday on', () => {
    expect(weekendFriday(new Date('2026-11-02T10:00:00Z'), TZ)).toBe(day('2026-11-06')); // Monday
    expect(weekendFriday(new Date('2026-11-05T10:00:00Z'), TZ)).toBe(day('2026-11-06')); // Thursday
    expect(weekendFriday(new Date('2026-11-06T10:00:00Z'), TZ)).toBe(day('2026-11-06')); // Friday
    expect(weekendFriday(new Date('2026-11-07T10:00:00Z'), TZ)).toBe(day('2026-11-06')); // Saturday
    expect(weekendFriday(new Date('2026-11-08T22:00:00Z'), TZ)).toBe(day('2026-11-06')); // Sunday
  });
});

describe('weekendGroupOf', () => {
  it('derives the spec groups from the entry group, Free from the label', () => {
    const at = '2026-11-07T19:00:00Z';
    expect(weekendGroupOf(entry('a', at, { group: 'Clubs & late' }))).toBe('Nights out & live music');
    expect(weekendGroupOf(entry('a', at, { group: 'Sport tonight' }))).toBe('Sport');
    expect(weekendGroupOf(entry('a', at, { group: 'Festivals & fairs' }))).toBe('Markets & food');
    expect(weekendGroupOf(entry('a', at, { group: 'Family' }))).toBe('Family');
    expect(weekendGroupOf(entry('a', at, { group: null, labels: ['Free'] }))).toBe('Free');
    expect(weekendGroupOf(entry('a', at, { group: null }))).toBe('Also on');
  });
});

describe('buildWeekendSections', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  it('Friday from 17:00, Saturday and Sunday all day; other days left out; rows capped per group with a remainder count', () => {
    const entries = [
      entry('thu', '2026-11-05T19:00:00Z'), entry('fri-lunch', '2026-11-06T12:00:00Z'), entry('fri-eve', '2026-11-06T19:00:00Z'),
      entry('sat-morning', '2026-11-07T10:00:00Z', { group: 'Family' }), entry('sun', '2026-11-08T15:00:00Z'), entry('mon', '2026-11-09T19:00:00Z'),
      ...Array.from({ length: 12 }, (_, i) => entry(`sat-${i}`, `2026-11-07T${String(17 + (i % 6)).padStart(2, '0')}:00:00Z`, { group: 'Comedy & shows' })),
    ];
    const [fri, sat, sun] = buildWeekendSections(entries, NOW, TZ, 5);
    expect([fri.kind, sat.kind, sun.kind]).toEqual(['friday', 'saturday', 'sunday']);
    expect(fri.count).toBe(1);
    expect(sat.count).toBe(13);
    expect(sun.count).toBe(1);
    const nights = sat.groups.find((g) => g.name === 'Nights out & live music')!;
    expect(nights.entries).toHaveLength(5);
    const shownComedy = nights.entries.length + nights.more + sat.highlights.filter((h) => h.group === 'Comedy & shows').length;
    expect(shownComedy).toBe(12);
  });
  it('hides a day that is over', () => {
    const now = new Date('2026-11-08T09:00:00Z');
    expect(weekendDayHidden(day('2026-11-07'), now, TZ)).toBe(true);
    expect(weekendDayHidden(day('2026-11-08'), now, TZ)).toBe(false);
  });
});
