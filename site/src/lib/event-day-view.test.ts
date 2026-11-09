import { readFileSync } from 'node:fs';
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

describe('dedupe: same title, same local day, start within 60 minutes is one event (owner 2026-11-05, born from the live Brookings duplicate)', () => {
  const CHI = 'America/Chicago';
  const NOW_B = new Date('2026-11-05T18:00:00Z');
  const arts = (id: string, startIso: string, title = 'SDSU Concert Choir Fall Concert'): FeedItem => ({
    sourceKind: 'arts', occurs_at: startIso,
    event: { external_event_id: id, title, teaser: null, location: 'The Oscar Larson Performing Arts Center', starts_at: startIso, ends_at: null, categories: [], primary_category: null, event_url: `/events/${id}` } as any,
  });
  const f = (i: FeedItem): RowFacts => ({ title: i.sourceKind === 'arts' ? i.event.title : i.story.title, venue: null, area: null, free: false, kids: false });
  const run = (items: FeedItem[]) => buildEventsView(items, { now: NOW_B, timezone: CHI, gb: false, facts: f });

  it('the real pair: 19:00 and 19:30 on Nov 6 Central (both Nov 7 in UTC) become one row on Fri Nov 6', () => {
    const v = run([arts('a#2026-11-06T19:00', '2026-11-07T01:00:00Z'), arts('b#2026-11-06T19:30', '2026-11-07T01:30:00Z')]);
    const fri = v.days.find((d) => d.dayKey === '2026-11-06')!;
    expect(fri.count).toBe(1);
    expect(fri.rows[0].timeLabel).toBe('7 PM');
    expect(fri.rows[0].merged).toHaveLength(1);
    expect(v.total).toBe(1);
  });
  it('a story and an arts listing of the same event merge too, and the merged row keeps free/kids from either', () => {
    const s = item({ slug: 's', title: 'SDSU Concert Choir Fall Concert', occurs_at: '2026-11-07T01:10:00Z' });
    const v = buildEventsView([s, arts('b', '2026-11-07T01:30:00Z')], { now: NOW_B, timezone: CHI, gb: false, facts: (i) => ({ ...f(i), free: i.sourceKind === 'arts' }) });
    expect(v.days[1].rows).toHaveLength(1);
    expect(v.days[1].rows[0].free).toBe(true);
  });
  it('does not merge: 90 minutes apart, another local day, or another title', () => {
    expect(run([arts('a', '2026-11-07T01:00:00Z'), arts('b', '2026-11-07T02:30:00Z')]).total).toBe(2);
    expect(run([arts('a', '2026-11-07T01:00:00Z'), arts('b', '2026-11-08T01:00:00Z')]).total).toBe(2);
    expect(run([arts('a', '2026-11-07T01:00:00Z'), arts('b', '2026-11-07T01:30:00Z', 'SDSU Wind Ensemble')]).total).toBe(2);
  });
  it('title match ignores case, punctuation and &', () => {
    expect(run([arts('a', '2026-11-07T01:00:00Z', 'Rock & Roll Night!'), arts('b', '2026-11-07T01:20:00Z', 'rock and roll night')]).total).toBe(1);
  });
});

describe('caps and front-page blocks', () => {
  const mkRow = (o: Partial<import('./event-day-view').DayRow>) => ({ item: null as any, dayKey: 'd', dateLabel: '', offset: 0, timeLabel: '', allDay: false, tonight: false, recurrence: 'one_off', title: 't', venue: null, area: null, free: false, kids: false, teens: false, cat: null, start: '', end: null, merged: [], ...o }) as import('./event-day-view').DayRow;
  const grp = (offset: number, rows: import('./event-day-view').DayRow[]) => ({ offset, dayKey: `k${offset}`, label: 'x', weekday: 'x', dateLabel: 'x', count: rows.length, rows });
  it('takeRows cuts in day order and reports what is hidden', async () => {
    const { takeRows } = await import('./event-day-view');
    const r = takeRows([grp(0, [mkRow({}), mkRow({})]), grp(1, [mkRow({}), mkRow({})]), grp(2, [mkRow({})])], 3);
    expect(r.days.map((d) => d.rows.length)).toEqual([2, 1]);
    expect(r.hidden).toBe(2);
  });
  it('homeBlocks puts each day in one block; today is never also in the weekend', async () => {
    const { homeBlocks } = await import('./event-day-view');
    const days = [0, 1, 2, 3, 4, 5, 6].map((o) => grp(o, [mkRow({ offset: o })]));
    const view = { days, furtherOut: [], total: 7 } as any;
    // a Saturday: anchor -1 -> weekend offsets -1..1: only tomorrow (Sunday) is still ahead
    const sat = homeBlocks(view, -1);
    expect(sat.today.map((d) => d.offset)).toEqual([0]);
    expect(sat.weekend.map((d) => d.offset)).toEqual([1]);
    expect(sat.week.map((d) => d.offset)).toEqual([2, 3, 4, 5, 6]);
    // a Wednesday: Friday is +2
    const wed = homeBlocks(view, 2);
    expect(wed.weekend.map((d) => d.offset)).toEqual([2, 3, 4]);
    expect(wed.week.map((d) => d.offset)).toEqual([1, 5, 6]);
  });
});

describe('strict time order (owner 2026-11-06: no row is lifted above an earlier one)', () => {
  const arts = (id: string, startIso: string): FeedItem => ({
    sourceKind: 'arts', occurs_at: startIso,
    event: { external_event_id: id, title: `Event ${id}`, teaser: null, location: 'Somewhere', starts_at: startIso, ends_at: null, categories: [], primary_category: null, event_url: `/events/${id}` } as any,
  });
  it('rows inside a day come out in start order whatever order they arrive in', () => {
    const f = (i: FeedItem): RowFacts => ({ title: (i as any).event.title, venue: null, area: null, free: false, kids: false });
    const v = buildEventsView(
      [arts('c', '2026-11-11T03:00:00Z'), arts('a', '2026-11-10T17:00:00Z'), arts('b', '2026-11-10T22:00:00Z')],
      { now: new Date('2026-11-10T16:00:00Z'), timezone: 'America/Chicago', gb: false, facts: f },
    );
    for (const d of v.days) {
      const starts = d.rows.map((r) => r.start);
      expect(starts, d.dayKey).toEqual([...starts].sort());
    }
    expect(v.days.flatMap((d) => d.rows.map((r) => r.title))).toEqual(['Event a', 'Event b', 'Event c']);
  });
});

describe('events never show a big card or a full-size FallbackTile', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the event and calendar lists import neither Card nor FallbackTile and carry no images', () => {
    for (const f of ['../components/pop/PopEventList.astro', '../components/pop/PopAcademicList.astro', '../components/pop/DayTile.astro']) {
      const src = read(f);
      expect(src, f).not.toMatch(/FallbackTile|ui\/Card|<Card|pickFeature|feature|<img/);
    }
  });
  it('the old per-day list and row components are gone and no page uses them', () => {
    for (const f of ['../pages/index.astro', '../pages/events.astro']) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/EventDayList|events\/EventRow/);
  });
  it('events.astro, the front page and /university/ print their lists with the date-tile components', () => {
    expect(readFileSync(new URL('../pages/events.astro', import.meta.url), 'utf8')).toMatch(/<PopEventList days=\{busyDays\}/);
    expect(readFileSync(new URL('../pages/index.astro', import.meta.url), 'utf8')).toMatch(/<PopEventList days=\{todayBlock\.days\}/);
    expect(readFileSync(new URL('../pages/university.astro', import.meta.url), 'utf8')).toMatch(/<PopAcademicList dates=\{academicDates\}/);
  });
});

describe('day boxes and date order per country (owner 2026-11-08: Glasgow showed "Tod"/"Tom" and month-first dates)', () => {
  const glasgow = buildEventsView([], { now: new Date('2026-11-08T13:00:00Z'), timezone: 'Europe/London', gb: true, facts: facts() });
  const brookings = buildEventsView([], { now: new Date('2026-11-08T13:00:00Z'), timezone: 'America/Chicago', gb: false, facts: facts() });
  it('every box carries the short weekday, today and tomorrow included (Sun, Mon, Tue ...)', () => {
    expect(glasgow.days.map((d) => d.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(brookings.days.map((d) => d.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });
  it('gb is day-first, us month-first, on the day groups', () => {
    expect(glasgow.days[0].dateLabel).toBe('8 Nov');
    expect(brookings.days[0].dateLabel).toBe('Nov 8');
  });
  it('gb is day-first on a row', () => {
    const v = buildEventsView([item({ slug: 'a', title: 'A', occurs_at: '2026-11-12T19:00:00Z' })], { now: new Date('2026-11-08T13:00:00Z'), timezone: 'Europe/London', gb: true, facts: facts() });
    expect(v.days[4].rows[0].dateLabel).toBe('12 Nov');
  });
  it('the glance strip uses the weekday, never a cut-down "Today"/"Tomorrow"', () => {
    const src = readFileSync(new URL('../components/events/EventsGlance.astro', import.meta.url), 'utf8');
    expect(src).toContain('label: d.weekday');
    expect(src).not.toMatch(/slice\(0, 3\)/);
  });
});

describe('"N things on today": big number only from hero_min_count (owner 2026-11-08)', () => {
  it('the threshold and the wording live in strings/<country>/events.json, and EventsGlance branches on it', async () => {
    const { eventsStrings, thingsOnToday } = await import('./events-strings');
    expect(eventsStrings('us').hero_min_count).toBe(5);
    expect(eventsStrings('gb').hero_min_count).toBe(5);
    expect(thingsOnToday(1, 'gb')).toBe('thing on today');
    expect(thingsOnToday(4, 'us')).toBe('things on today');
    const src = readFileSync(new URL('../components/events/EventsGlance.astro', import.meta.url), 'utf8');
    expect(src).toMatch(/view\.todayCount >= strings\.hero_min_count \?/);
    expect(src).toContain('<h2 class="evg__title">');
  });
});
