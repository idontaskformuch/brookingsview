/** The /today copy is built from the sources the town actually has (owner 2026-10-28, Q3 on Glasgow: the page promised "school status" and
 *  "road conditions", which Glasgow does not have, and "events today and tomorrow" over an empty Tomorrow). A promise is only made for
 *  a module the town's configuration switches on. */
import type { SiteConfig } from './site-config';
import { joinWithOr } from './status-line';

type Cfg = Pick<SiteConfig, 'country' | 'hasClosureWatch' | 'trafficSource'> & { hasWhatsOn?: boolean };

/** What the page can honestly show, in reading order. Weather warnings and the day's events exist for every town. */
export function todayModules(c: Cfg): string[] {
  const modules = [c.country === 'gb' ? 'weather warnings' : 'weather alerts'];
  if (c.hasClosureWatch) modules.push('school status');
  if (c.trafficSource) modules.push('road conditions');
  modules.push('events today and tomorrow');
  return modules;
}

const list = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function todayShows(c: Cfg, cityName: string): string {
  return `What matters in ${cityName} right now: ${list(todayModules(c))}.`;
}

export function todayDescription(c: Cfg, placeAbbr: string): string {
  return `What's happening today in ${placeAbbr}: ${list(todayModules(c))}.`;
}

/** "National Weather Service alerts, local school and road-condition sources, and event organizers' own calendars" -- only the parts the town has. */
export function todaySources(c: Cfg): string {
  const gb = c.country === 'gb';
  const parts = [gb ? 'Met Office warnings' : 'National Weather Service alerts'];
  const local: string[] = [];
  if (c.hasClosureWatch) local.push('school');
  if (c.trafficSource) local.push('road-condition');
  if (local.length) parts.push(`local ${joinWithOr(local).replace(' or ', ' and ')} sources`);
  if (gb && c.hasWhatsOn) parts.push('Ticketmaster');
  parts.push(`event ${gb ? 'organisers' : 'organizers'}' own calendars`); // gb-spelling
  return list(parts);
}
