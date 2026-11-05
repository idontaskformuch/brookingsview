/** The meetings of the active town as /city-hall/ and its calendar and feed files see them: rows -> views, upcoming only. Shared so the page,
 *  the per-meeting .ics, the subscription calendars and the RSS feeds can never disagree about what a meeting is. null for a town that is not
 *  on the structured meetings layout (config/meetings.ts). */
import { getMeetingRowsForView } from './db';
import { MEETINGS_TOWNS, buildMeetings, isUpcoming, type MeetingView, type MeetingsTownConfig } from './meetings-view';
import { siteConfig } from './site-config';

export const todayInTown = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: siteConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function loadUpcomingMeetings(): Promise<{ cfg: MeetingsTownConfig; meetings: MeetingView[]; todayYmd: string } | null> {
  const cfg = MEETINGS_TOWNS[siteConfig.townId];
  if (!cfg) return null;
  const todayYmd = todayInTown();
  const meetings = buildMeetings(await getMeetingRowsForView(), siteConfig.timezone, siteConfig.meetingsHaveTime, undefined, cfg)
    .filter((m) => isUpcoming(m, Date.now(), todayYmd));
  return { cfg, meetings, todayYmd };
}
