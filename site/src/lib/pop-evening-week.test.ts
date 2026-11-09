import { describe, expect, it } from 'vitest';
import { timeTile } from './event-pop';
import { eveningCategory } from './pop-categories';
import { eveningPopDays, weekPopDays } from './pop-days';
import type { EveningEntry } from './evening-items';
import type { WeekRow } from './week-groups';

const CHI = 'America/Chicago';

describe('timeTile (the tile of a single-day list)', () => {
  it('splits the clock the old rows print: "7:30pm" -> 7:30 over PM, "7pm" -> 7 over PM, in the town\'s zone', () => {
    expect(timeTile('2026-11-13T01:30:00Z', CHI)).toEqual({ main: '7:30', kicker: 'PM', label: '7:30pm' });
    expect(timeTile('2026-11-13T01:00:00Z', CHI)).toMatchObject({ main: '7', kicker: 'PM' });
    expect(timeTile('2026-11-12T15:15:00Z', CHI)).toMatchObject({ main: '9:15', kicker: 'AM' });
  });
  it('no time (local midnight) = no tile', () => {
    expect(timeTile('2026-11-12T06:00:00Z', CHI)).toBeNull();
  });
});

describe('eveningCategory', () => {
  it('maps the groups with an honest match and leaves the rest without a dot', () => {
    expect(eveningCategory('Live music')).toBe('music');
    expect(eveningCategory('Theatre')).toBe('arts');
    expect(eveningCategory('Clubs & late')).toBe('nightlife');
    expect(eveningCategory('Sport')).toBe('sports');
    expect(eveningCategory('Festivals & fairs')).toBeNull();
    expect(eveningCategory(null)).toBeNull();
  });
});

const entry = (o: Partial<EveningEntry>): EveningEntry => ({
  id: 'x', title: 'Open mic', start: '2026-11-13T01:30:00Z', end: null, group: 'Live music', labels: [], venue: 'The Bar', href: '/s/open-mic/', source: 'own',
  distanceMiles: null, driveMinutes: null, checked: '2026-11-12', ...o,
});

describe('eveningPopDays', () => {
  it('one day, in time order, with the old meta parts and the labels as tags (Free stays a flag)', () => {
    const days = eveningPopDays([
      entry({ id: 'b', title: 'Late', start: '2026-11-13T03:00:00Z' }),
      entry({ id: 'a', labels: ['Free', '18+'], area: 'Downtown', laterStarts: ['2026-11-13T03:30:00Z'] }),
    ], CHI, 'us');
    expect(days).toHaveLength(1);
    const [first, second] = days[0].rows;
    expect([first.title, second.title]).toEqual(['Open mic', 'Late']);
    expect(first).toMatchObject({ free: true, tags: ['18+'], venue: 'The Bar', area: 'Downtown', cat: 'music', href: '/s/open-mic/', note: 'Also 9:30pm' });
  });
  it('a row after local midnight is a new day', () => {
    const days = eveningPopDays([entry({}), entry({ title: 'Next', start: '2026-11-13T07:00:00Z' })], CHI, 'us');
    expect(days.map((d) => d.dayKey)).toEqual(['2026-11-12', '2026-11-13']);
  });
});

describe('weekPopDays', () => {
  const row = (o: Partial<WeekRow>): WeekRow => ({ when: 'Fri 7pm', title: 'Volleyball', href: 'https://x.test/', external: true, venue: 'Frost Arena', start: '2026-11-14T01:00:00Z', end: null, ...o });
  it('takes the clock time out of "Fri 7pm", keeps the link and venue, groups by local day', () => {
    const days = weekPopDays([row({}), row({ when: 'Fri', title: 'Council', start: '2026-11-13T06:00:00Z' }), row({ when: 'Sat all day', title: 'Fair', start: '2026-11-14T06:00:00Z' })], CHI);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-11-13', '2026-11-13', '2026-11-14'].filter((v, i, a) => a.indexOf(v) === i));
    const rows = days.flatMap((d) => d.rows);
    expect(rows.map((r) => r.timeLabel)).toEqual(['7pm', '', 'all day']);
    expect(rows[0]).toMatchObject({ href: 'https://x.test/', venue: 'Frost Arena', title: 'Volleyball' });
  });
});
