/** One .ics per upcoming meeting that has a real start and a place, generated at build time like s/[slug].ics.ts. Only towns on
 *  the structured meetings layout (config/meetings.ts) get any; a meeting without a time or a place gets none. */
import type { APIRoute } from 'astro';
import { loadUpcomingMeetings } from '../../../lib/meetings-data';
import { buildMeetingIcs, canCalendar, type MeetingView } from '../../../lib/meetings-view';
import { siteConfig } from '../../../lib/site-config';

export async function getStaticPaths() {
  const data = await loadUpcomingMeetings();
  if (!data) return [];
  return data.meetings.filter(canCalendar).map((m) => ({ params: { id: String(m.id) }, props: { m } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const { m } = props as { m: MeetingView };
  const base = site ?? siteConfig.siteUrl;
  const ics = buildMeetingIcs(m, { siteName: siteConfig.siteName, domain: siteConfig.domain }, new URL('/city-hall/', base).href);
  if (!ics) throw new Error(`buildMeetingIcs() returned null for a path getStaticPaths() generated: meeting ${m.id}`);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${m.id}.ics"`,
    },
  });
};
