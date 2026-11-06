import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getActiveSchoolAlerts, getFacilities, getUpcomingStories, getUpcomingArtsEvents } from '../lib/db';
import { siteConfig } from '../lib/site-config';
import { placeLabel } from '../lib/country-profile';
import { loadUpcomingMeetings } from '../lib/meetings-data';
import { buildMeetingFeedItems } from '../lib/meetings-view';
import { buildTownEventsView } from '../lib/events-town-view';
import { itemLink } from '../lib/events';
import { buildSiteFeed, type FeedEvent } from '../lib/site-feed';
import { weekInfoForInstant } from '../lib/this-week';

// The sitewide feed is built from structured fields only (lib/site-feed.ts): agendas the source dates, cancelled / postponed meetings,
// school closures, and at most five of the town's own events a week. Touring shows from outside the town are never in it. No model-written
// text exists in this feed (owner 2026-11-06); the stories table is not read here.
const DAYS_AHEAD = 14;

export async function GET(context: APIContext) {
  const site = context.site ?? new URL(siteConfig.siteUrl);
  const tz = siteConfig.timezone;
  const now = new Date();

  const meetingData = await loadUpcomingMeetings();
  const meetingItems = meetingData ? buildMeetingFeedItems(meetingData.meetings, new URL('/city-hall/', site).href) : [];
  const closures = siteConfig.closureWatch ? await getActiveSchoolAlerts(14) : [];

  const [stories, arts, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
  const town = buildTownEventsView(stories, arts, facilities, now);
  const horizon = now.getTime() + DAYS_AHEAD * 86_400_000;
  const events: FeedEvent[] = [...town.view.days.flatMap((d) => d.rows), ...town.view.furtherOut]
    .filter((r) => new Date(r.start).getTime() <= horizon)
    .map((r) => ({
      id: r.item.sourceKind === 'story' ? r.item.story.slug : `arts-${r.item.event.event_url ?? r.title}-${r.start}`,
      title: r.title, startIso: r.start, dateLabel: r.dateLabel, timeLabel: r.timeLabel || null, venue: r.venue,
      link: itemLink(r.item), publishedAt: r.item.sourceKind === 'story' ? r.item.story.published_at : null,
    }));

  const items = buildSiteFeed({
    meetingItems, closures, events,
    closuresPageUrl: siteConfig.closureWatch ? new URL('/closures/', site).href : null,
    eventsPageUrl: new URL('/events/', site).href,
    weekOf: (iso) => weekInfoForInstant(new Date(iso), tz).slug,
    now,
  });
  return rss({
    title: siteConfig.siteName,
    description: `Meeting agendas, cancellations, school closures and a few events in ${placeLabel(siteConfig)}.`,
    site,
    items: items.map((i) => ({ title: i.title, description: i.description, link: i.link, pubDate: i.pubDate, guid: i.guid })),
  });
}
