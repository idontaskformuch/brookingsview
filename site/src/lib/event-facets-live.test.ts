import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_FACETS, type FacetContext } from './event-facets';
import { liveFacetSlugs, townFacets } from './event-facets-live';
import type { FeedItem } from './events';
import type { Facility } from './db';

// Owner 2026-11-24: no empty-state text on /events/<facet>/; an empty facet is hidden from the facet navigation and stays noindex.
const facetPage = readFileSync(new URL('../pages/events/[facet].astro', import.meta.url), 'utf8');
const eventsPage = readFileSync(new URL('../pages/events.astro', import.meta.url), 'utf8');
const thisWeek = readFileSync(new URL('../components/ThisWeekView.astro', import.meta.url), 'utf8');

const ctx = (facilities: Partial<Facility>[] = []): FacetContext => ({ facilities: facilities as Facility[], today: new Date('2026-11-24T00:00:00Z'), timezone: 'America/Los_Angeles' });

describe('liveFacetSlugs', () => {
  it('with no events, nothing is live; free is live as soon as an always-free facility exists', () => {
    const facets = townFacets('moreno_valley_ca');
    expect([...liveFacetSlugs(facets, [], ctx())]).toEqual([]);
    expect([...liveFacetSlugs(facets, [], ctx([{ category: 'library' }]))]).toEqual(['free']);
  });
  it('a facet is live when an event matches it', () => {
    const facets = EVENT_FACETS.filter((f) => f.slug === 'kids' || f.slug === 'library');
    const fake = [{ sourceKind: 'story' } as unknown as FeedItem];
    const only = [{ ...facets[0], matches: () => true }, { ...facets[1], matches: () => false }];
    expect([...liveFacetSlugs(only, fake, ctx())]).toEqual([only[0].slug]);
  });
  it('campus is only a Brookings facet', () => {
    expect(townFacets('moreno_valley_ca').some((f) => f.slug === 'campus')).toBe(false);
    expect(townFacets('brookings_sd').some((f) => f.slug === 'campus')).toBe(true);
  });
});

describe('pages', () => {
  it('the facet page prints no empty-state text and hides the list once every card has ended', () => {
    expect(facetPage).not.toContain('CalendarEmpty');
    expect(facetPage).not.toContain('emptyMessage');
    expect(facetPage).not.toContain('facet-empty-fallback');
    expect(facetPage).toContain('data-hide-when-empty');
    expect(facetPage).toContain('const isNoindex = true;');
  });
  it('every facet navigation row links only live facets', () => {
    expect(facetPage).toContain('live.includes(f.slug)');
    expect(eventsPage).toContain('liveFacets.has(f.slug)');
    expect(thisWeek).toContain("liveFacets.has('free')");
    expect(thisWeek).toContain("liveFacets.has('kids')");
  });
});
