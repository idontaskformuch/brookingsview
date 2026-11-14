/** Events on a holiday page taken from the town's own event calendars (owner 2026-11-14, B2): the rows /events/ shows
 *  (lib/events-town-view.ts, so the frozen filter, the merge and the in-town / nearby split are the same), kept when the
 *  title matches the holiday's `calendarMatch.pattern` and the local day is inside its window. Plain regex, no model text:
 *  the row's own title, day, time and venue. Every match is logged in the build output ("[holiday-calendar]"), with the
 *  ones a town excludes by key (config/holiday-pages/registry.ts CALENDAR_EXCLUDES) marked as such.
 *
 *  Only stories (source_type 'event') are matched; SDSU arts rows have no read date to show and Brookings takes no part. */
import type { FeedItem } from './events';
import { itemLink, itemTitle, itemVenue } from './events';
import type { ConfirmedEvent, EventVenue } from './holiday-page';
import { occurrenceDay } from './holiday-calendar';
import type { HolidayPageDef } from '../config/holiday-pages/calendar';

const DAY = 86_400_000;

export interface CalendarCandidate {
  item: FeedItem;
  /** Set for a row in the /events/ "nearby" zone (miles, or null when unknown); undefined in town. */
  nearbyMiles?: number | null;
}

export interface CalendarMatchLine { key: string; date: string; title: string; included: boolean; reason?: string }

/** Key a town uses to exclude a row: the story's slug ("event-330656"), which carries the events id. */
export function calendarKey(item: FeedItem): string | null {
  return item.sourceKind === 'story' ? item.story.slug : null;
}

function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "Farm House Collective, 1393 University Ave, Riverside, CA, ..." -> name and street as the source gives them; nothing
 *  is looked up. A second part that does not start with a house number is not taken as a street. */
export function venueFromRaw(raw: string | null): EventVenue | null {
  const parts = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const street = parts[1] && /^\d/.test(parts[1]) ? parts[1] : undefined;
  return { name: parts[0], ...(street ? { street } : {}), locality: (street ? parts[2] : parts[1]) ?? '' };
}

/** The matched rows as confirmed events, and one report line per title match (excluded ones included). */
export function matchCalendarEvents(
  def: HolidayPageDef, year: number, candidates: CalendarCandidate[], timeZone: string, exclude: Record<string, string>,
): { events: ConfirmedEvent[]; report: CalendarMatchLine[] } {
  const rule = def.calendarMatch;
  if (!rule) return { events: [], report: [] };
  const day = occurrenceDay(def, year);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const first = iso(day - rule.daysBefore * DAY);
  const last = iso(day + rule.daysAfter * DAY);
  const events: ConfirmedEvent[] = [];
  const report: CalendarMatchLine[] = [];
  for (const { item, nearbyMiles } of candidates) {
    const key = calendarKey(item);
    if (!key || item.sourceKind !== 'story' || !item.occurs_at) continue;
    const title = itemTitle(item);
    if (!rule.pattern.test(title)) continue;
    const { date, time } = localParts(item.occurs_at, timeZone);
    if (date < first || date > last) continue;
    if (key in exclude) { report.push({ key, date, title, included: false, reason: exclude[key] }); continue; }
    const venue = venueFromRaw(itemVenue(item));
    const link = itemLink(item);
    if (!venue || !link) { report.push({ key, date, title, included: false, reason: !venue ? 'no venue' : 'no link' }); continue; }
    report.push({ key, date, title, included: true });
    const sourceUrl = item.story.source_url ?? link;
    events.push({
      status: 'confirmed', name: title, date, venue, url: link,
      ...(time !== '00:00' ? { startTime: time } : {}), // midnight = a date-only row
      ...(nearbyMiles !== undefined ? { nearby: { miles: nearbyMiles } } : {}),
      source: { name: venue.name, url: sourceUrl },
      checkedOn: localParts(item.story.published_at, timeZone).date,
      fromCalendar: key,
    });
  }
  events.sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  return { events, report };
}

/** Build-log lines for the report. */
export function formatCalendarReport(slug: string, townId: string, report: CalendarMatchLine[]): string[] {
  const head = `[holiday-calendar] ${slug} ${townId}: ${report.filter((r) => r.included).length} shown, ${report.filter((r) => !r.included).length} excluded`;
  return [head, ...report.map((r) => `[holiday-calendar]   ${r.included ? 'shown   ' : 'excluded'} ${r.key} ${r.date} "${r.title}"${r.reason ? ` (${r.reason})` : ''}`)];
}
