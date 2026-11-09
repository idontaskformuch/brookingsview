import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countWeekItems, isThinWeek, THIS_WEEK_MIN_ITEMS } from './week-count.mjs';
import { THIS_WEEK_MIN_ITEMS as FROM_THIS_WEEK, weekInfoForInstant, buildWeekDays } from './this-week';
import type { Story, SdsuEvent } from './db';

const TZ = 'America/Chicago';
// Monday 2026-11-09 .. Sunday 2026-11-15 (2026-w46)
const WEEK = weekInfoForInstant(new Date('2026-11-11T18:00:00Z'), TZ);

function story(o: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'event', source_url: null, occurs_at: null,
    published_at: '2026-11-01T12:00:00Z', generated_by: 'scraper', byline: null, image_path: null, image_alt: null,
    rating: null, ingredients: null, instructions: null, ...o,
  } as Story;
}
function arts(o: Partial<SdsuEvent>): SdsuEvent {
  return {
    external_event_id: 'a1', title: 'Untitled', teaser: null, location: null, starts_at: null, ends_at: null,
    categories: [], primary_category: null, event_url: null, ...o,
  } as SdsuEvent;
}

// A week one item over the threshold, where two rows must NOT count: a superseded duplicate and the same show listed by a second calendar.
const unique = [
  story({ id: 1, slug: 'a', title: 'Farmers Market', occurs_at: '2026-11-10T16:00:00Z', source_url: 'https://visitbrookingssd.com/e/market' }),
  story({ id: 2, slug: 'b', title: 'Story Hour', occurs_at: '2026-11-11T16:00:00Z', source_url: 'https://library.example/story' }),
];
const superseded = story({ id: 3, slug: 'c-old', title: 'Story Hour', occurs_at: '2026-11-12T16:00:00Z', superseded_by_slug: 'c-new' });
const kept = story({ id: 4, slug: 'c-new', title: 'Chess Club', occurs_at: '2026-11-12T16:00:00Z', source_url: 'https://library.example/chess' });
const dupArts = arts({ title: 'Farmers Market', starts_at: '2026-11-10T16:00:00Z', event_url: 'https://sdstate.edu/e/market' });

describe('countWeekItems', () => {
  it('uses the same threshold as lib/this-week', () => {
    expect(THIS_WEEK_MIN_ITEMS).toBe(FROM_THIS_WEEK);
  });

  it('near the threshold: a superseded row and a cross-source duplicate do not count (3 items, not 5)', () => {
    const data = { stories: [...unique, superseded, kept], artsEvents: [dupArts] };
    const counts = countWeekItems(data, TZ);
    expect(counts.get(WEEK.slug)).toBe(3);
    expect(isThinWeek(counts.get(WEEK.slug) ?? 0)).toBe(false);
  });

  it('one more drop puts the week under the threshold', () => {
    const counts = countWeekItems({ stories: [...unique, superseded], artsEvents: [dupArts] }, TZ);
    expect(counts.get(WEEK.slug)).toBe(2);
    expect(isThinWeek(counts.get(WEEK.slug) ?? 0)).toBe(true);
  });

  it('agrees with the items the page lists for the week (buildWeekDays), the sitemap and the page share this count', () => {
    for (const data of [
      { stories: [...unique, superseded, kept], artsEvents: [dupArts] },
      { stories: [...unique, superseded], artsEvents: [dupArts] },
    ]) {
      const counted = countWeekItems(data, TZ).get(WEEK.slug) ?? 0;
      // the page's own data comes from getStoriesForWeekly(), which already leaves superseded rows out
      const pageStories = data.stories.filter((s) => !s.superseded_by_slug);
      const days = buildWeekDays(WEEK, TZ, {
        eventStories: pageStories, meetingStories: [], artsEvents: data.artsEvents, projectUpdates: [], games: [], regionalGames: [],
      });
      expect(counted).toBe(days.reduce((n, d) => n + d.items.length, 0));
    }
  });

  it('counts meetings by bare date, project updates, games and regional games', () => {
    const counts = countWeekItems({
      stories: [story({ id: 9, slug: 'm', title: 'City Council', source_type: 'meeting', occurs_at: '2026-11-10T00:00:00Z' })],
      projectUpdates: [{ meeting_date: '2026-11-10' }],
      gameStarts: ['2026-11-14T00:30:00Z'],
      regionalGameDates: ['2026-11-15'],
    }, TZ);
    expect(counts.get(WEEK.slug)).toBe(4);
  });
});

describe('the sitemap filter and the page use the shared count', () => {
  it('astro.config.mjs and this-week/[week].astro both call countWeekItems/isThinWeek', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../pages/this-week/[week].astro', import.meta.url), 'utf8');
    for (const src of [cfg, page]) {
      expect(src).toMatch(/countWeekItems\(/);
      expect(src).toMatch(/isThinWeek\(/);
      expect(src).toContain('week-count.mjs');
    }
  });
});
