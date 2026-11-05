/** RSS for one organ's meetings; a feed exists for every organ the town lists even when nothing is scheduled (an empty feed is valid). */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { loadUpcomingMeetings } from '../../../../lib/meetings-data';
import { buildMeetingFeedItems, followableOrgans, type MeetingView } from '../../../../lib/meetings-view';
import { siteConfig } from '../../../../lib/site-config';

export async function getStaticPaths() {
  const data = await loadUpcomingMeetings();
  if (!data) return [];
  return followableOrgans(data.meetings, data.cfg).map((o) => ({
    params: { organ: o.key },
    props: { label: o.label, meetings: data.meetings.filter((m) => m.bodyKey === o.key) },
  }));
}

export async function GET(context: APIContext) {
  const { label, meetings } = context.props as { label: string; meetings: MeetingView[] };
  const pageUrl = new URL('/city-hall/', context.site ?? siteConfig.siteUrl).href;
  return rss({
    title: `${label}: ${siteConfig.cityName} meetings`,
    description: `New meetings and published agendas for ${label} in ${siteConfig.cityName}.`,
    site: context.site!,
    items: buildMeetingFeedItems(meetings, pageUrl).map((i) => ({ title: i.title, description: i.description, link: i.link, pubDate: i.pubDate, guid: i.guid })),
  });
}
