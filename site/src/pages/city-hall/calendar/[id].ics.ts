/** One .ics per upcoming meeting that has a real start and a place, generated at build time like s/[slug].ics.ts. Only towns on
 *  the structured meetings layout (lib/meetings-view.ts MEETINGS_TOWNS) get any; a county row without a time gets none. */
import type { APIRoute } from 'astro';
import { getMeetingRowsForView } from '../../../lib/db';
import { MEETINGS_TOWNS, buildMeetings, buildMeetingIcs, canCalendar, isUpcoming, type MeetingView } from '../../../lib/meetings-view';
import { siteConfig } from '../../../lib/site-config';

export async function getStaticPaths() {
  if (!MEETINGS_TOWNS[siteConfig.townId]) return [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: siteConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const meetings = buildMeetings(await getMeetingRowsForView(), siteConfig.timezone, siteConfig.meetingsHaveTime)
    .filter((m) => isUpcoming(m, Date.now(), today) && canCalendar(m));
  return meetings.map((m) => ({ params: { id: String(m.id) }, props: { m } }));
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
