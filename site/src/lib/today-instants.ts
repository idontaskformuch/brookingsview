/** Start/end instants of the events /today/ can list (same feed, same candidate selection), for the header's
 *  "N events today" (BaseLayout). Counting these through countToday() makes the number equal the list by construction. */
import { getUpcomingStories, getUpcomingArtsEvents } from './db';
import { buildEventFeed, todayUtcMidnight, selectBucketCandidates } from './events';
import { siteConfig } from './site-config';

let cached: Promise<{ start: string; end: string | null }[]> | null = null;

export function getTodayInstants(): Promise<{ start: string; end: string | null }[]> {
  cached ??= (async () => {
    const [stories, arts] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60)]);
    const { items } = buildEventFeed(stories, arts, siteConfig.timezone);
    return selectBucketCandidates(items, todayUtcMidnight(siteConfig.timezone), siteConfig.timezone)
      .filter((i) => i.occurs_at)
      .map((i) => {
        const end = i.sourceKind === 'story' ? i.story.ends_at : i.event.ends_at;
        return { start: new Date(i.occurs_at!).toISOString(), end: end ? new Date(end).toISOString() : null };
      });
  })();
  return cached;
}
