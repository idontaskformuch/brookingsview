/** Subscribable calendar for one organ. A file exists for every organ the town lists (and every organ in the data) even when nothing is
 *  scheduled, so a subscription made today still works after the last meeting has passed. */
import type { APIRoute } from 'astro';
import { loadUpcomingMeetings } from '../../../../lib/meetings-data';
import { buildMeetingsFeedIcs, followableOrgans, type MeetingView } from '../../../../lib/meetings-view';
import { siteConfig } from '../../../../lib/site-config';

export async function getStaticPaths() {
  const data = await loadUpcomingMeetings();
  if (!data) return [];
  return followableOrgans(data.meetings, data.cfg).map((o) => ({
    params: { organ: o.key },
    props: { label: o.label, meetings: data.meetings.filter((m) => m.bodyKey === o.key) },
  }));
}

export const GET: APIRoute = ({ props, site }) => {
  const { label, meetings } = props as { label: string; meetings: MeetingView[] };
  const ics = buildMeetingsFeedIcs(
    meetings, { siteName: siteConfig.siteName, domain: siteConfig.domain },
    new URL('/city-hall/', site ?? siteConfig.siteUrl).href, `${label} (${siteConfig.cityName})`,
  );
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
