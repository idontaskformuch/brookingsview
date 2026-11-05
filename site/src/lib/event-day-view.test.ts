import { describe, expect, it } from 'vitest';
import {
  buildEventsView, recurrenceKind, isFreeByCost, clockLabel, bodyNamesWrongDay, DAYSTRIP_MIN_EVENTS,
  type RowFacts,
} from './event-day-view';
import type { FeedItem } from './events';
import type { Story } from './db';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'event',
    source_url: null, occurs_at: null, published_at: '2026-11-01T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null,
    ...overrides,
  };
}
const item = (s: Partial<Story>): FeedItem => ({ sourceKind: 'story', occurs_at: (s.occurs_at as string) ?? null, story: story(s) });
const facts = (over: Partial<RowFacts> = {}) => (i: FeedItem): RowFacts => ({
  title: i.sourceKind === 'story' ? i.story.title : '', venue: null, area: null, free: false, kids: false, ...over,
});

const LA = 'America/Los_Angeles';
// Moreno Valley, Tue 10 Nov 2026 12:00 PST. Both events below start on the 10th LOCAL, on the 11th in UTC (born from
// the owner's report 2026-11-05: "kvällsevents visar textdatum en dag fel"; real row event-327253, 03:00Z = 19:00 PST).
const NOW = new Date('2026-11-10T20:00:00Z');
const evening = item({ slug: 'event-327253', title: 'Mrs. Doubtfire Outdoor Screening', occurs_at: '2026-11-11T03:00:00Z', ends_at: '2026-11-11T05:00:00Z' } as Partial<Story>);
const late = item({ slug: 'late', title: 'Open mic', occurs_at: '2026-11-11T06:30:00Z', ends_at: '2026-11-11T08:00:00Z' } as Partial<Story>);
const noon = item({ slug: 'noon', title: 'Storytime', occurs_at: '2026-11-10T20:30:00Z', ends_at: '2026-11-10T21:30:00Z' } as Partial<Story>);
const tomorrow = item({ slug: 'tomorrow', title: 'Craft hour', occurs_at: '2026-11-11T18:00:00Z' });

describe('Moreno evening events land on the local date (regression, born from the UTC-date bug)', () => {
  it('the fixture discriminates: its UTC date is the next day', () => {
    expect(String(evening.occurs_at).slice(0, 10)).toBe('2026-11-11');
  });
  const view = buildEventsView([evening, late, noon, tomorrow], { now: NOW, timezone: LA, gb: false, facts: facts() });
  it('groups a 19:00 and a 22:30 local event under today, not tomorrow', () => {
    expect(view.days[0].offset).toBe(0);
    expect(view.days[0].rows.map((r) => (r.item as any).story.slug)).toEqual(['noon', 'event-327253', 'late']);
    expect(view.days[1].rows.map((r) => (r.item as any).story.slug)).toEqual(['tomorrow']);
  });
  it('headings carry the local day, not the UTC one', () => {
    expect(view.days[0]).toMatchObject({ label: 'Today', dateLabel: 'Nov 10', dayKey: '2026-11-10' });
    expect(view.days[1]).toMatchObject({ label: 'Tomorrow', dateLabel: 'Nov 11', dayKey: '2026-11-11' });
  });
  it('counts today and tonight on the local date', () => {
    expect(view.todayCount).toBe(3);
    expect(view.tonightCount).toBe(2);
  });
  it('shows local clock times', () => {
    expect(view.days[0].rows.map((r) => r.timeLabel)).toEqual(['12:30 PM', '7 PM', '10:30 PM']);
  });
});

describe('days and counts', () => {
  const mk = (n: number, iso: string) => Array.from({ length: n }, (_, i) => item({ slug: `${iso}-${i}`, title: `E${i}`, occurs_at: iso }));
  it('always returns seven local days starting today, empty days included', () => {
    const v = buildEventsView(mk(2, '2026-11-12T18:00:00Z'), { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(v.days).toHaveLength(7);
    expect(v.days.map((d) => d.count)).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(v.days[2].label).toBe('Thu');
  });
  it('items past the window are returned as furtherOut, not dropped', () => {
    const later = item({ slug: 'later', occurs_at: '2026-11-25T18:00:00Z' });
    const v = buildEventsView([later], { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(v.furtherOut).toHaveLength(1);
    expect(v.total).toBe(1);
  });
  it('the day strip needs enough events in the window', () => {
    const few = buildEventsView(mk(DAYSTRIP_MIN_EVENTS - 1, '2026-11-11T18:00:00Z'), { now: NOW, timezone: LA, gb: false, facts: facts() });
    const enough = buildEventsView(mk(DAYSTRIP_MIN_EVENTS, '2026-11-11T18:00:00Z'), { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(few.showDayStrip).toBe(false);
    expect(enough.showDayStrip).toBe(true);
  });
  it('items without a start are skipped from the day groups', () => {
    const v = buildEventsView([item({ slug: 'x', occurs_at: null })], { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(v.days.every((d) => d.count === 0)).toBe(true);
  });
});

describe('hero and insight', () => {
  it('free today only with data and N > 0', () => {
    const freeFacts = (i: FeedItem): RowFacts => ({ ...facts()(i), free: (i as any).story.slug === 'noon' });
    const v = buildEventsView([noon, evening], { now: NOW, timezone: LA, gb: false, facts: freeFacts });
    expect(v.freeToday).toBe(1);
    const none = buildEventsView([noon, evening], { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(none.freeToday).toBe(0);
  });
  it('nothing today points at the next day that has events', () => {
    const v = buildEventsView([tomorrow], { now: NOW, timezone: LA, gb: false, facts: facts() });
    expect(v.todayCount).toBe(0);
    expect(v.nextDay).toMatchObject({ label: 'Tomorrow', count: 1 });
  });
});

describe('free: structured cost first, venue rule as fallback', () => {
  it('Glasgow cost strings', () => {
    expect(isFreeByCost('Free')).toBe(true);
    expect(isFreeByCost('Free, ticket required')).toBe(true);
    expect(isFreeByCost('Free, drop-in, no ticket required')).toBe(true);
    expect(isFreeByCost('£23.90 (includes booking fee)')).toBe(false);
    expect(isFreeByCost('Payment required')).toBe(false);
    expect(isFreeByCost('Freestyle workshop £5')).toBe(false);
  });
  it('no cost field means unknown (null), never false', () => {
    expect(isFreeByCost(undefined)).toBeNull();
    expect(isFreeByCost('')).toBeNull();
  });
});

describe('recurrence enum', () => {
  it('maps the source text; regular is never shown', () => {
    expect(recurrenceKind({ is_recurring_series: false } as Story)).toBe('one_off');
    expect(recurrenceKind({ is_recurring_series: true, meta: { recurrence: 'Every week on Tuesday' } } as unknown as Story)).toBe('weekly');
    expect(recurrenceKind({ is_recurring_series: true, meta: { recurrence: 'Every 2 weeks on Monday' } } as unknown as Story)).toBe('weekly');
    expect(recurrenceKind({ is_recurring_series: true, meta: { recurrence: 'Monthly on the first Friday' } } as unknown as Story)).toBe('monthly');
    expect(recurrenceKind({ is_recurring_series: true, meta: {} } as unknown as Story)).toBe('regular');
  });
});

describe('clock labels', () => {
  it('US 12-hour, gb compact, all day is empty on gb', () => {
    expect(clockLabel('2026-11-11T03:00:00Z', null, LA, false)).toBe('7 PM');
    expect(clockLabel('2026-11-11T03:30:00Z', null, LA, false)).toBe('7:30 PM');
    expect(clockLabel('2026-11-11T19:30:00Z', null, 'Europe/London', true)).toBe('7:30pm');
    expect(clockLabel('2026-11-11T19:00:00Z', null, 'Europe/London', true)).toBe('7pm');
    expect(clockLabel('2026-11-10T08:00:00Z', null, LA, false)).toBe('All day');
    expect(clockLabel('2026-11-11T00:00:00Z', null, 'Europe/London', true)).toBe('');
  });
});

describe('body text that names the UTC day instead of the local one (the stored text from the live bug)', () => {
  // Real rows: event-67503 starts 2026-12-08T00:00Z = Mon 7 Dec 16:00 PST, body says "December 8 from 4 p.m."
  it('flags a body naming only the UTC date', () => {
    expect(bodyNamesWrongDay('Family Fun returns on December 8 from 4 p.m. to 5 p.m.', '2026-12-08T00:00:00Z', LA)).toBe(true);
  });
  it('accepts a body naming the local date, or no date, or both', () => {
    expect(bodyNamesWrongDay('Family Fun returns on December 7 from 4 p.m.', '2026-12-08T00:00:00Z', LA)).toBe(false);
    expect(bodyNamesWrongDay('A creative project for all ages.', '2026-12-08T00:00:00Z', LA)).toBe(false);
    expect(bodyNamesWrongDay('Runs December 7 and December 8.', '2026-12-08T00:00:00Z', LA)).toBe(false);
  });
  it('same-day events can never be wrong', () => {
    expect(bodyNamesWrongDay('On December 8 at noon.', '2026-12-08T20:00:00Z', LA)).toBe(false);
  });
});
