/** Which /events/<facet>/ pages have anything to show (owner 2026-11-24: no empty-state texts anywhere). An empty facet is still built (its URL
 *  keeps working, and every facet page is noindex), but it is left out of every facet navigation row until it has content again. One query set,
 *  the same as pages/events/[facet].astro's getStaticPaths, so a link and its page never disagree. */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities, type Facility } from './db';
import { buildEventFeed, todayUtcMidnight, FREE_VENUE_CATEGORIES, type FeedItem } from './events';
import { EVENT_FACETS, type EventFacet, type FacetContext } from './event-facets';
import { siteConfig } from './site-config';
import { withoutEnded } from './local-day';

export interface FacetData {
  items: FeedItem[];
  alsoListedBy: Map<FeedItem, string[]>;
  facilities: Facility[];
  ctx: FacetContext;
}

let cached: Promise<FacetData> | null = null;

export function getFacetData(): Promise<FacetData> {
  cached ??= (async () => {
    const [upcoming, artsEvents, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
    const { items, alsoListedBy } = buildEventFeed(withoutEnded(upcoming, new Date(), siteConfig.timezone), artsEvents, siteConfig.timezone);
    return { items, alsoListedBy, facilities, ctx: { facilities, today: todayUtcMidnight(siteConfig.timezone), timezone: siteConfig.timezone } };
  })();
  return cached;
}

/** The facets this town builds (campus only in Brookings). */
export function townFacets(townId: string = siteConfig.townId): EventFacet[] {
  return EVENT_FACETS.filter((f) => !f.brookingsOnly || townId === 'brookings_sd');
}

/** Pure: a facet is live when an event matches it; 'free' also when the town has an always-free facility (its page lists those). */
export function liveFacetSlugs(facets: EventFacet[], items: FeedItem[], ctx: FacetContext): Set<string> {
  const freeFacilities = ctx.facilities.some((f) => FREE_VENUE_CATEGORIES.has(f.category));
  return new Set(facets.filter((f) => items.some((i) => f.matches(i, ctx)) || (f.slug === 'free' && freeFacilities)).map((f) => f.slug));
}

export async function getLiveFacetSlugs(): Promise<Set<string>> {
  const { items, ctx } = await getFacetData();
  return liveFacetSlugs(townFacets(), items, ctx);
}
