import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FROZEN_EVENT_SOURCES, frozenCutoff, hiddenFrozenSlugs } from './frozen-sources.mjs';

const LA = 'America/Los_Angeles';
const FROZEN = FROZEN_EVENT_SOURCES.moreno_valley_ca;

// Real Moreno rows (stories joined to events, read 2026-11-13): event-5293 "Moreno Valley: Shop for a Cause Fundraiser" (city_events),
// occurs_at 2026-11-28T02:00Z = Fri 27 Nov 6pm local, the last day of the window; event-6229 "Moreno Valley: MV MALL BRANCH: Toddler Time"
// (library), occurs_at 2026-11-28T19:00Z = Sat 28 Nov 11am local, the first day after it.
const WITHIN = { slug: 'event-5293', source: 'city_events', occurs_at: '2026-11-28T02:00:00Z' };
const LATER = { slug: 'event-6229', source: 'library', occurs_at: '2026-11-28T19:00:00Z' };
// farm_house_collective is not frozen: event-series-a675bb313eb1884c "Country Night", occurs_at 2026-11-22T02:00Z, with its date moved
// past the window as the only changed field.
const NOT_FROZEN = { slug: 'event-series-a675bb313eb1884c', source: 'farm_house_collective', occurs_at: '2026-12-22T02:00:00Z' };

describe('frozen sources (owner 2026-11-13)', () => {
  it('a frozen row inside the 14 days is shown, a later one is hidden', () => {
    expect(hiddenFrozenSlugs([WITHIN, LATER], FROZEN, LA)).toEqual(['event-6229']);
  });

  it('without the "frozen" entry both are shown', () => {
    expect(hiddenFrozenSlugs([WITHIN, LATER], undefined, LA)).toEqual([]);
    expect(hiddenFrozenSlugs([WITHIN, LATER], {}, LA)).toEqual([]);
  });

  it('only a frozen source is touched, and a row without a date is never hidden', () => {
    expect(hiddenFrozenSlugs([NOT_FROZEN, { ...LATER, occurs_at: null }], FROZEN, LA)).toEqual([]);
  });

  it('the limit is fixed: through 2026-11-27 local, so the first hidden instant is local midnight 28 Nov', () => {
    expect(frozenCutoff(FROZEN.library, LA).toISOString()).toBe('2026-11-28T08:00:00.000Z');
  });
});

// Empty lists in a town with its own calendars: one sentence and a link to the city's or the library's calendar.
describe('empty-list calendar links', () => {
  it('library and kids point to the library calendar, the rest to the city calendar', () => {
    const src = readFileSync(new URL('./event-facets.ts', import.meta.url), 'utf8');
    const calendarOf = (slug: string) => src.split(`slug: '${slug}'`)[1].split('slug:')[0].match(/calendar: '(\w+)'/)?.[1];
    expect(['today', 'this-weekend', 'kids', 'library', 'outdoor'].map(calendarOf)).toEqual(['city', 'city', 'library', 'library', 'city']);
  });
  it('the sentence ends before the link: "<lead>. See the <calendar>." (owner 2026-11-14)', () => {
    const comp = readFileSync(new URL('../components/events/CalendarEmpty.astro', import.meta.url), 'utf8');
    expect(comp).toContain('{lead}. See the <a href={cal.url}>{cal.label}</a>.');
    expect(comp).not.toContain('— see the');
  });
});

// The rule sits in every story query that can return an event (lib/db.ts), and the sitemap mirror runs the same lookup.
describe('FROZEN_FILTER in the queries', () => {
  const db = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
  const fnBody = (name: string) => {
    const start = db.indexOf(`function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const rest = db.slice(start + 1);
    const next = rest.search(/\nexport (async )?function /);
    return next === -1 ? rest : rest.slice(0, next);
  };
  for (const name of [
    'getUpcomingStories', 'getAllStories', 'getPastStories', 'getStoriesForWeekly', 'getRelatedStories',
    'getWorthKnowingCandidates', 'getStoriesForNewsSitemap', 'getSignData',
  ]) {
    it(`${name}: every FROM stories query leaves the hidden slugs out`, () => {
      const blocks = fnBody(name).split(/\bFROM stories\b/).slice(1);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) expect(block.slice(0, block.indexOf('`'))).toContain('slug != ALL(${hidden}::text[]) -- FROZEN_FILTER');
    });
  }

  it('the sitemap mirror (astro.config.mjs) drops the same slugs from its stories', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    expect(cfg).toContain('hiddenFrozenSlugs(');
    expect(cfg).toContain('slug != ALL(${frozenHiddenSlugs}::text[])');
  });
});
