/** What each live page is for, how to use it and where its data comes from. This text used to sit in a box at the top of the page
 *  ("What this shows / How to use it / Sources"); the content pages carry no explanation box any more
 *  (owner 2026-11-07), so it is collected here and printed on /how-we-gather-this/. Only pages the town actually has are listed. */
import type { SiteConfig } from './site-config';
import { enabledSections } from './nav-sections';
import { SAFETY_TOWNS } from './safety-towns';
import { todaySources, todayShows } from './today-copy';

export interface PageExplainer { name: string; href: string; shows: string; use: string; sources: string }

type Cfg = Pick<SiteConfig, 'townId' | 'cityName' | 'country' | 'hasClosureWatch' | 'trafficSource' | 'closureWatch' | 'safetyNotices' | 'eveningLayer' | 'hasWhatsOn'>;

export function pageExplainers(c: Cfg): PageExplainer[] {
  const out: PageExplainer[] = [{
    name: 'Today', href: '/today/', shows: todayShows(c, c.cityName),
    use: 'Check it before you leave the house or plan the evening. Anything with a warning or closure links to the official notice, which is the one to rely on.',
    sources: todaySources(c),
  }];
  if (c.closureWatch) {
    out.push({
      name: 'School closures', href: '/closures/',
      shows: `Whether ${c.closureWatch.districtName} has announced a school closure, delay or early release, alongside any weather alerts that could cause one.`,
      use: 'Check it on a snowy or stormy morning. If nothing is confirmed there, confirm with the district before assuming school is on: the page never predicts a closure.',
      sources: `${c.closureWatch.districtName}'s own announcements and National Weather Service alerts.`,
    });
  }
  if (enabledSections(c as SiteConfig).some((x) => x.id === 'traffic')) {
    out.push({
      name: 'Traffic', href: '/traffic/',
      shows: `Road incidents, lane closures and construction reported near ${c.cityName}, with severity and location.`,
      use: "Look before you drive and filter by severity. An empty list means nothing was reported, not that the roads are guaranteed clear. For snow or ice, check the official source too.",
      sources: c.trafficSource ? `${c.trafficSource.name}, refreshed with each site update.` : 'No public live incident feed exists for this area that we can show; weather alerts are on the weather page.',
    });
  }
  if (c.safetyNotices && SAFETY_TOWNS[c.townId]) {
    out.push({
      name: 'Fire and air', href: '/safety/',
      shows: `Wildfires within ${SAFETY_TOWNS[c.townId].radiusMiles} miles of ${c.cityName} and the current air-quality index, each with the source's own numbers and the time it was last updated.`,
      use: 'Check it when you see smoke or hear about a fire. For a decision about leaving or staying, use the official evacuation pages, not this list.',
      sources: 'Fires: the National Interagency Fire Center (NIFC). Air quality: AirNow, run by the US EPA.',
    });
  }
  if (c.eveningLayer) {
    out.push({
      name: 'Tonight and this weekend', href: '/tonight/',
      shows: `Events in ${c.cityName} that start this evening or tomorrow evening, and from Friday evening to Sunday night, grouped by what they are, with the start time and the venue.`,
      use: "Pick the group that fits, then open the listing for the source's own details before you go. Times and tickets can change.",
      sources: "The organizers' own calendars and, where the town has them, Ticketmaster listings and OpenStreetMap opening hours.",
    });
  }
  return out;
}
