import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSiteFeed, MAX_EVENTS_PER_WEEK, type FeedEvent } from './site-feed';
import type { FeedItem } from './meetings-view';

const NOW = new Date('2026-11-10T12:00:00Z');
const weekOf = (iso: string) => String(Math.floor((new Date(iso).getTime() - Date.UTC(2026, 10, 9)) / (7 * 86_400_000)));
const ev = (n: number, startIso: string, over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: `e${n}`, title: `Event ${n}`, startIso, dateLabel: 'Sat, Nov 14', timeLabel: '7:00pm', venue: 'Library', link: `https://example.org/e${n}`, publishedAt: '2026-11-01T10:00:00Z', ...over,
});
const meeting = (kind: FeedItem['kind'], n: number): FeedItem => ({ kind, guid: `m${n}-${kind}`, title: `${kind} ${n}`, link: `https://example.org/m${n}`, pubDate: new Date(`2026-11-0${n}T10:00:00Z`), description: 'Tue, Nov 10' });
const base = { meetingItems: [] as FeedItem[], closures: [], events: [] as FeedEvent[], closuresPageUrl: 'https://x.test/closures/', eventsPageUrl: 'https://x.test/events/', weekOf, now: NOW };

describe('buildSiteFeed', () => {
  it('keeps agenda, cancelled and postponed meetings, and leaves a plain "new meeting" to the meetings feed', () => {
    const out = buildSiteFeed({ ...base, meetingItems: [meeting('agenda', 1), meeting('cancelled', 2), meeting('postponed', 3), meeting('new', 4)] });
    expect(out.map((i) => i.guid).sort()).toEqual(['m1-agenda', 'm2-cancelled', 'm3-postponed']);
  });
  it('lists at most five of the town\'s own events per week, earliest first', () => {
    const events = Array.from({ length: 8 }, (_, i) => ev(i, `2026-11-1${i}T18:00:00Z`.replace('1' + i, String(10 + i)))); // Nov 10..17
    const out = buildSiteFeed({ ...base, events });
    const week1 = events.filter((e) => weekOf(e.startIso) === weekOf(events[0].startIso));
    expect(out.filter((i) => i.guid.startsWith('event-')).length).toBe(Math.min(MAX_EVENTS_PER_WEEK, week1.length) + Math.min(MAX_EVENTS_PER_WEEK, events.length - week1.length));
    expect(out.filter((i) => i.guid.startsWith('event-') && week1.some((e) => `event-${e.id}` === i.guid)).length).toBeLessThanOrEqual(MAX_EVENTS_PER_WEEK);
  });
  it('six events in one week give five', () => {
    const events = Array.from({ length: 6 }, (_, i) => ev(i, `2026-11-11T1${i}:00:00Z`));
    expect(buildSiteFeed({ ...base, events }).length).toBe(5);
  });
  it('an event with no link is left out, and an item is never dated in the future', () => {
    const out = buildSiteFeed({ ...base, events: [ev(1, '2026-11-12T18:00:00Z', { link: null }), ev(2, '2026-11-12T18:00:00Z', { publishedAt: '2027-01-01T00:00:00Z' })] });
    expect(out).toHaveLength(1);
    expect(out[0].pubDate.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
  it('a closure links the district notice, or our closures page when it has none', () => {
    const out = buildSiteFeed({ ...base, closures: [
      { district: 'Brookings School District', title: 'No school Monday', url: 'https://district.example/notice', posted_at: '2026-11-09T05:00:00Z' },
      { district: 'Other District', title: null, url: null, posted_at: '2026-11-09T06:00:00Z' },
    ] });
    expect(out.map((i) => i.link).sort()).toEqual(['https://district.example/notice', 'https://x.test/closures/']);
    expect(out.every((i) => i.title.startsWith('Closure: '))).toBe(true);
  });
  it('a closure without any link is left out', () => {
    expect(buildSiteFeed({ ...base, closuresPageUrl: null, closures: [{ district: 'D', title: 'T', url: null, posted_at: '2026-11-09T05:00:00Z' }] })).toEqual([]);
  });
  it('is newest first', () => {
    const out = buildSiteFeed({ ...base, meetingItems: [meeting('agenda', 1), meeting('agenda', 3)] });
    expect(out.map((i) => i.guid)).toEqual(['m3-agenda', 'm1-agenda']);
  });
});

describe('/rss.xml carries no model-written text and no big shows', () => {
  const page = readFileSync(new URL('../pages/rss.xml.ts', import.meta.url), 'utf8');
  it('does not read stories or the story body', () => {
    expect(page).not.toMatch(/getAllStories|\.body\b|publicBody|storyHref/);
  });
  it('takes its events from the local view, never from Ticketmaster or big shows', () => {
    expect(page).toMatch(/buildTownEventsView/);
    expect(page).not.toMatch(/ticketmaster|big-shows|getBigShows/i);
  });
});
