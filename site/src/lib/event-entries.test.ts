/** Designsystem Fas 2 (owner 2026-11-20): dedup, series and THE events-today count, against the real Brookings rows that gave the
 *  header ticker 6, /events/ 7 and /today/ 6 on Nov 20 (fixtures/events-brookings-2026-11-20.json, read-only SELECT 16:09 UTC). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from './fixtures/events-brookings-2026-11-20.json';
import rooms from './fixtures/events-glasgow-rooms-2026-11-20.json';
import { buildEventFeed, itemTitle, type FeedItem } from './events';
import { venueRoom } from './event-dedup.mjs';
import { buildEntries, seriesLabel, entryDays, joinTimes, titlesOverlap, venueKey, type EventEntry } from './event-entries';
import { countEventsToday } from './local-day';
import { buildEventsView, type RowFacts } from './event-day-view';
import { buildTownEventsView, buildTownEntries, countableEntries } from './events-town-view';
import { eventClock } from './time';
import type { Story, SdsuEvent } from './db';

const CHI = 'America/Chicago';
const NOW = new Date(fixture.now); // 10:09 AM Central, Nov 20
// The fixture leaves out the stories' AI text (body); the row facts only scan it for kids words, so an empty body stands in.
const stories = fixture.stories.map((s) => ({ ...s, body: '' })) as unknown as Story[];
const arts = fixture.arts as unknown as SdsuEvent[];
const entries = (): EventEntry[] => buildEntries(buildEventFeed(stories, arts, CHI).items, CHI);
const byTitle = (es: EventEntry[], t: string) => es.filter((e) => itemTitle(e.item) === t);
const times = (e: EventEntry) => joinTimes(e.occ.map((o) => eventClock(o.start, CHI)));

describe('one entry per real event (fixture: Brookings, Nov 20)', () => {
  it('Grace Fromknect: the 2 PM pair at the Oscar is one entry and keeps the longer title', () => {
    const es = entries();
    expect(byTitle(es, 'Grace Fromknect Recital')).toHaveLength(0);
    const [g] = byTitle(es, 'Grace Fromknect & Ava Gibbs Recital');
    expect(g.merged.map(itemTitle)).toEqual(['Grace Fromknect Recital']);
    expect(times(g)).toBe('2 PM');
  });
  it('History Club 20s Event at 3 PM and 7 PM is one entry: "3 PM & 7 PM"', () => {
    const h = byTitle(entries(), 'History Club 20s Event');
    expect(h).toHaveLength(1);
    expect(times(h[0])).toBe('3 PM & 7 PM');
  });
  it('the CNS brunch at 8 and 9 AM on Nov 21 is one entry: "8 AM & 9 AM"', () => {
    const c = byTitle(entries(), 'College of Natural Sciences (CNS) Scholarship & Fellowship Brunch');
    expect(c).toHaveLength(1);
    expect(times(c[0])).toBe('8 AM & 9 AM');
  });
  it('Gifting for Good at McCrory Gardens on Nov 20 and 21 is one series; the Ag Heritage Museum listing (another place) stays apart', () => {
    const es = entries();
    const [g] = byTitle(es, 'Gifting for Good');
    expect(seriesLabel(entryDays(g, CHI), false)).toBe('Nov 20–21');
    expect(byTitle(es, 'Gifting for Good at Ag Heritage Museum')).toHaveLength(1);
  });
  it('McCrory Gardens Closed - Thanksgiving Break, Nov 26 and 27, is one series', () => {
    const [m] = byTitle(entries(), 'McCrory Gardens Closed - Thanksgiving Break');
    expect(seriesLabel(entryDays(m, CHI), false)).toBe('Nov 26–27');
    expect(seriesLabel(entryDays(m, CHI), true)).toBe('26–27 Nov');
  });
  it('a third date makes "3 dates, ..." (the real McCrory row, starts_at moved to Nov 29: the only changed field)', () => {
    const m = arts.find((a) => a.title === 'McCrory Gardens Closed - Thanksgiving Break')!;
    const extra = { ...m, starts_at: '2026-11-29T16:00:00.000Z', ends_at: '2026-11-29T23:00:00.000Z' };
    const [e] = byTitle(buildEntries(buildEventFeed([], [...arts, extra], CHI).items, CHI), m.title);
    expect(seriesLabel(entryDays(e, CHI), false)).toBe('3 dates, Nov 26–29');
  });
  it('Arts at The Oscar (story 4204 + the SDSU listing) is still one entry', () => {
    expect(byTitle(entries(), 'Arts at The Oscar')).toHaveLength(1);
  });
  it('the three Nov 22 recitals at the Oscar stay three (other titles, even at the same 7 PM)', () => {
    const es = entries();
    for (const t of ['Madilynn Hallan Senior Recital', 'Theodore Nilson Senior Recital', 'Jacob Stevens Senior Showcase']) expect(byTitle(es, t)).toHaveLength(1);
  });
});

describe('THE events-today count: ticker, /today/ and /events/ agree (they were 6 / 6 / 7)', () => {
  it('5 in town at 10:09 AM: Playful Preschoolers (recurring, counted), Gifting for Good, the Fromknect recital, History Club, Arts at The Oscar', () => {
    const t = buildTownEntries(stories, arts, [], NOW);
    expect(countEventsToday(countableEntries(t), NOW, CHI)).toEqual({ town: 5, nearby: 0 });
  });
  it('/events/ (view.todayCount and TownEventsView.today) gives the same number from the same function', () => {
    const v = buildTownEventsView(stories, arts, [], NOW);
    expect(v.view.todayCount).toBe(5);
    expect(v.today).toEqual({ town: 5, nearby: 0 });
    expect(v.view.days[0].rows.map((r) => [r.timeLabel, r.title, r.seriesLabel])).toEqual([
      ['8:30 AM', 'Playful Preschoolers', null],
      ['10 AM', 'Gifting for Good', 'Nov 20–21'],
      ['2 PM', 'Grace Fromknect & Ava Gibbs Recital', null],
      ['3 PM & 7 PM', 'History Club 20s Event', null],
      ['5:30 PM', 'Arts at The Oscar', null],
    ]);
  });
  it('after 5 PM Gifting for Good moves to its Nov 21 date and the count drops with what has ended', () => {
    const at6pm = new Date('2026-11-21T00:00:00Z'); // 6 PM Central
    const t = buildTownEntries(stories, arts, [], at6pm);
    // History Club (until 10 PM) and Arts at The Oscar (until 10 PM) are still on
    expect(countEventsToday(countableEntries(t), at6pm, CHI).town).toBe(2);
    const f = (i: FeedItem): RowFacts => ({ title: itemTitle(i), venue: null, area: null, free: false, kids: false });
    const v = buildEventsView(t.here, { now: at6pm, timezone: CHI, gb: false, facts: f });
    expect(v.days[1].rows.map((r) => r.title)).toContain('Gifting for Good');
  });
});

describe('helpers', () => {
  it('venueKey: "The Oscar Larson Performing Arts Center" and the story address form are one place', () => {
    expect(venueKey('The Oscar Larson Performing Arts Center')).toBe(venueKey('Oscar Larson Performing Arts Center, 1601 University Boulevard, Brookings, SD, 57007'));
  });
  it('titlesOverlap: containment of at least two words; a single shared word is not enough', () => {
    expect(titlesOverlap('Grace Fromknect Recital', 'Grace Fromknect & Ava Gibbs Recital')).toBe(true);
    expect(titlesOverlap('Theodore Nilson Senior Recital', 'Madilynn Hallan Senior Recital')).toBe(false);
  });
  it('joinTimes: "1 PM, 3 PM & 7 PM"', () => {
    expect(joinTimes(['1 PM', '3 PM', '7 PM'])).toBe('1 PM, 3 PM & 7 PM');
  });
});

describe('QA registry (CLAUDE.md 12)', () => {
  it('logic.events-today-one-count is registered with born_from', () => {
    const reg = JSON.parse(readFileSync(new URL('../../../qa/checks.json', import.meta.url), 'utf8')).checks as Record<string, { born_from: string }>;
    expect(reg['logic.events-today-one-count']?.born_from).toBeTruthy();
  });
});

describe('the boundary: one name, two rooms or two subtitles (owner 2026-11-20)', () => {
  // Real Glasgow rows (fixtures/events-glasgow-rooms-2026-11-20.json): venue_raw names the room as its second comma part.
  const GLA = 'Europe/London';
  const [suite, auditorium] = rooms.stories.map((s) => ({ ...s, body: '' })) as unknown as Story[];
  const glaEntries = (ss: Story[]) => buildEntries(buildEventFeed(ss, [], GLA).items, GLA);

  it('room data exists: the same concert at the same time in two rooms of one hall stays two entries', () => {
    // Story 4081 (Strathclyde Suite) and story 4081 with ONLY venue_raw changed to story 4151's "Glasgow Royal Concert Hall, New Auditorium".
    const other = { ...suite, id: -4081, venue_raw: auditorium.venue_raw };
    const es = glaEntries([suite, other]);
    expect(es).toHaveLength(2);
    expect(es.map((e) => e.occ.length)).toEqual([1, 1]);
  });
  it('a room on one side only is not a different place: the bare hall and the Strathclyde Suite at 2 PM are one entry', () => {
    // Story 4081 with ONLY venue_raw changed to the bare "Glasgow Royal Concert Hall" (stories 4038/4078 list it that way).
    const bare = { ...suite, id: -4081, venue_raw: 'Glasgow Royal Concert Hall' };
    expect(glaEntries([suite, bare])).toHaveLength(1);
  });
  it('venueRoom: a room is the second comma part, never an address', () => {
    expect(venueRoom(suite.venue_raw)).toBe('strathclyde suite');
    expect(venueRoom(auditorium.venue_raw)).toBe('new auditorium');
    expect(venueRoom('Oscar Larson Performing Arts Center, 1601 University Boulevard, Brookings, SD, 57007')).toBeNull();
    expect(venueRoom('Moreno Valley Public Library Iris Plaza Branch,16170 Perris Blvd Suite C3, Moreno Valley, CA 92551')).toBeNull();
  });

  // Brookings: SDSU's location is the building only ("The Oscar Larson Performing Arts Center"), never a room. Without room data the
  // titles decide. This LOCKS today's behaviour, it does not claim it is right: a subtitle naming a room is only words in the title.
  const grace = arts.find((a) => a.title === 'Grace Fromknect Recital')!;
  const sdsu = (as: SdsuEvent[]) => buildEntries(buildEventFeed([], as, CHI).items, CHI);
  it('no room data, two different subtitles: stay two (real row "Grace Fromknect Recital", ONLY title changed on each copy)', () => {
    const a = { ...grace, external_event_id: `${grace.external_event_id}#jones`, title: 'Grace Fromknect Recital – Jones Hall' };
    const b = { ...grace, external_event_id: `${grace.external_event_id}#founders`, title: 'Grace Fromknect Recital – Founders Room' };
    expect(sdsu([a, b]).map((e) => itemTitle(e.item))).toEqual([a.title, b.title]);
  });
  it('no room data, the owner\'s exact pair "Recital – Jones Hall" / "Recital – Founders Room": stay two', () => {
    const a = { ...grace, external_event_id: `${grace.external_event_id}#jones`, title: 'Recital – Jones Hall' };
    const b = { ...grace, external_event_id: `${grace.external_event_id}#founders`, title: 'Recital – Founders Room' };
    expect(sdsu([a, b])).toHaveLength(2);
  });
  it('no room data, one title without the subtitle: TODAY they merge into the longer title (containment, same place, same time)', () => {
    // Locked on purpose: with only a building to go on, "Grace Fromknect Recital" and "Grace Fromknect Recital – Founders Room" read as one
    // event listed twice. If a source ever gives rooms, venueRoom() above keeps them apart instead.
    const b = { ...grace, external_event_id: `${grace.external_event_id}#founders`, title: 'Grace Fromknect Recital – Founders Room' };
    const es = sdsu([grace, b]);
    expect(es).toHaveLength(1);
    expect(itemTitle(es[0].item)).toBe(b.title);
  });
});
