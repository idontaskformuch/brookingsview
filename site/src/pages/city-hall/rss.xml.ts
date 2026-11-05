/** RSS for the whole town's meetings: a new meeting scheduled, an agenda the source dates as published. Built from fields (lib/meetings-view.ts
 *  buildMeetingFeedItems), no prose. Static, rebuilt with the site; no subscriber data is kept. */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { loadUpcomingMeetings } from '../../lib/meetings-data';
import { buildMeetingFeedItems } from '../../lib/meetings-view';
import { siteConfig } from '../../lib/site-config';

export async function GET(context: APIContext) {
  const data = await loadUpcomingMeetings();
  if (!data) return new Response('Not found', { status: 404 });
  const pageUrl = new URL('/city-hall/', context.site ?? siteConfig.siteUrl).href;
  return rss({
    title: `${siteConfig.cityName} meetings`,
    description: `New meetings and published agendas for ${siteConfig.cityName}.`,
    site: context.site!,
    items: buildMeetingFeedItems(data.meetings, pageUrl).map((i) => ({ title: i.title, description: i.description, link: i.link, pubDate: i.pubDate, guid: i.guid })),
  });
}
