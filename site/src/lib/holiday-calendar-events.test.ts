/** Holiday pages take matching rows from the town's own event calendars (owner 2026-11-14, B2). Fixtures are the real
 *  Moreno Valley stories 4195 (event-329806), 4208 (event-330656), 4243 (event-332324) and 3785 (event-303372), fields
 *  copied from the database on 2026-11-14 (CLAUDE.md rule 15). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeedItem } from './events';
import type { Story } from './db';
import { buildHolidayEventsJsonLd, eventWhenWhere, type HolidayPageData } from './holiday-page';
import { formatCalendarReport, matchCalendarEvents, venueFromRaw, type CalendarCandidate } from './holiday-calendar-events';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import { calendarExcludesFor } from '../config/holiday-pages/registry';
import { buildThanksgivingPage } from '../config/holiday-pages/thanksgiving';

const TZ = 'America/Los_Angeles';
const FARM = 'Farm House Collective, 1393 University Ave, Riverside, CA, 92507, United States';
const story = (id: number, slug: string, title: string, occurs_at: string, published_at: string, source_url: string, venue_raw: string): FeedItem => ({
  sourceKind: 'story', occurs_at,
  story: { id, slug, title, occurs_at, published_at, source_url, venue_raw, body: '', source_type: 'event' } as unknown as Story,
});
const CHARLIE = story(4195, 'event-329806', 'A Charlie Brown Thanksgiving + Fantastic Mr. Fox Outdoor Screening', '2026-11-25T02:00:00Z',
  '2026-11-08T23:02:47Z', 'https://farmhousecollective.com/event/a-charlie-brown-thanksgiving-fantastic-mr-fox-outdoor-screening/', FARM);
const HAPPY = story(4208, 'event-330656', 'Happy Thanksgiving', '2026-11-27T01:15:00Z', '2026-11-10T11:02:11Z',
  'https://farmhousecollective.com/event/happy-thanksgiving/', FARM);
const TREE = story(4243, 'event-332324', 'Christmas Tree Lighting', '2026-11-29T02:00:00Z', '2026-11-13T11:02:44Z',
  'https://farmhousecollective.com/event/christmas-tree-lighting/', FARM);
const LIBRARY = story(3785, 'event-303372', 'LIBRARY CLOSED: Thanksgiving / Biblioteca cerrada - Día de Acción de Gracias', '2026-11-26T08:00:00Z',
  '2026-10-02T02:52:21Z', 'https://tockify.com/moreno.valley.library/detail/932/1795680000000',
  'Moreno Valley Public Library Mall Branch,22500 Town Cir Suite 2078, Moreno Valley, CA 92553, USA, http://www.moval.org/mv-library/');

const def = holidayPageDef('thanksgiving')!;
const nearby = (item: FeedItem, miles: number | null): CalendarCandidate => ({ item, nearbyMiles: miles });

describe('calendar rows on a holiday page', () => {
  const exclude = calendarExcludesFor('thanksgiving', 'moreno_valley_ca')!;
  const { events, report } = matchCalendarEvents(def, 2026, [nearby(CHARLIE, 12.6), nearby(HAPPY, 12.6), nearby(TREE, 12.6), { item: LIBRARY }], TZ, exclude);

  it('keeps title matches inside the window, in local time, and drops the excluded keys', () => {
    expect(events.map((e) => [e.fromCalendar, e.date, e.startTime])).toEqual([
      ['event-329806', '2026-11-24', '18:00'],
      ['event-332324', '2026-11-28', '18:00'], // tree lighting the Saturday after: inside daysAfter 3
    ]);
    expect(report.filter((r) => !r.included).map((r) => r.key)).toEqual(['event-330656', 'event-303372']);
  });
  it('a nearby row says so with its distance, like /events/', () => {
    expect(eventWhenWhere(events[0])).toBe('Tue, Nov 24 · 6:00 p.m. · Farm House Collective, 1393 University Ave · Nearby, 13 mi away');
    expect(events[0].source).toEqual({ name: 'Farm House Collective', url: 'https://farmhousecollective.com/event/a-charlie-brown-thanksgiving-fantastic-mr-fox-outdoor-screening/' });
    expect(events[0].checkedOn).toBe('2026-11-08');
  });
  it('a row outside the window or without a matching title is not a match at all', () => {
    const late = story(4243, 'event-332324', 'Christmas Tree Lighting', '2026-11-30T09:00:00Z', /* Mon Nov 30, 1 a.m. local */ '2026-11-13T11:02:44Z', 'https://farmhousecollective.com/event/christmas-tree-lighting/', FARM);
    const other = story(4195, 'event-329806', 'Fantastic Mr. Fox Outdoor Screening', '2026-11-25T02:00:00Z', '2026-11-08T23:02:47Z', 'https://farmhousecollective.com/', FARM); // title changed
    expect(matchCalendarEvents(def, 2026, [{ item: late }, { item: other }], TZ, {}).report).toEqual([]);
  });
  it('calendar rows get no Event JSON-LD on the holiday page (they have their own pages)', () => {
    const page: HolidayPageData = { ...buildThanksgivingPage('moreno_valley_ca')!, events };
    expect(buildHolidayEventsJsonLd(page, TZ)).toEqual([]);
  });
  it('the build log names every match and why one is left out', () => {
    const lines = formatCalendarReport('thanksgiving', 'moreno_valley_ca', report);
    expect(lines[0]).toBe('[holiday-calendar] thanksgiving moreno_valley_ca: 2 shown, 2 excluded');
    expect(lines.some((l) => l.includes('excluded event-330656 2026-11-26 "Happy Thanksgiving" (raw_data has no description'))).toBe(true);
  });
  it('venue name and street come from the raw string as given', () => {
    expect(venueFromRaw(FARM)).toEqual({ name: 'Farm House Collective', street: '1393 University Ave', locality: 'Riverside' });
    expect(venueFromRaw(null)).toBeNull();
  });
  it('Brookings takes no part; Broomfield and Moreno do', () => {
    expect(calendarExcludesFor('thanksgiving', 'brookings_sd')).toBeNull();
    expect(calendarExcludesFor('thanksgiving', 'broomfield_co')).toEqual({});
    expect(calendarExcludesFor('veterans-day', 'broomfield_co')).toBeNull();
  });
  it('the route adds the rows and logs them', () => {
    const src = readFileSync(new URL('../pages/[holiday].astro', import.meta.url), 'utf8');
    expect(src).toContain('matchCalendarEvents(');
    expect(src).toContain('formatCalendarReport(');
  });
});
