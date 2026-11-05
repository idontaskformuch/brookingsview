/** Subscribable calendar of every upcoming meeting with a start and a place (webcal://<domain>/city-hall/calendar.ics). Static: rebuilt with the
 *  site every 6 hours; calendar apps re-read it on their own schedule (REFRESH-INTERVAL asks for 12 h). No personal data is kept or needed. */
import type { APIRoute } from 'astro';
import { loadUpcomingMeetings } from '../../lib/meetings-data';
import { buildMeetingsFeedIcs } from '../../lib/meetings-view';
import { siteConfig } from '../../lib/site-config';

export const GET: APIRoute = async ({ site }) => {
  const data = await loadUpcomingMeetings();
  if (!data) return new Response('Not found', { status: 404 });
  const ics = buildMeetingsFeedIcs(
    data.meetings, { siteName: siteConfig.siteName, domain: siteConfig.domain },
    new URL('/city-hall/', site ?? siteConfig.siteUrl).href, `${siteConfig.cityName} meetings`,
  );
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
