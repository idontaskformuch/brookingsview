/** Events on a holiday page taken from the town's own event calendars (owner 2026-11-14, B2): the rows /events/ shows
 *  (lib/events-town-view.ts, so the frozen filter, the merge and the in-town / nearby split are the same), kept when the
 *  title matches the holiday's `calendarMatch.pattern` and the local day is inside its window. Plain regex, no model text:
 *  the row's own title, day, time and venue. Every match is logged in the build output ("[holiday-calendar]"), with the
 *  ones a town excludes by key (config/holiday-pages/registry.ts CALENDAR_EXCLUDES) marked as such.
 *
 *  Only stories (source_type 'event') are matched; SDSU arts rows have no read date to show and Brookings takes no part. */
import type { FeedItem } from './events';
import { itemLink, itemTitle, itemVenue } from './events';
import { formatClock, type ConfirmedEvent, type EventVenue } from './holiday-page';
import { occurrenceDay } from './holiday-calendar';
import type { HolidayPageDef } from '../config/holiday-pages/calendar';
import { REGISTER_MAX_AGE_DAYS, showTitleKey, type RegisterRow } from './evening-items';
import type { TicketmasterFeedItem } from './ticketmaster';

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

/** The matched rows as confirmed events, and one report line per title match (excluded ones included). A key in `include` is
 *  taken without a title match (still inside the window), with its reason in the report: a row the owner named by id whose title
 *  the pattern does not cover ("Elf Academy", 2026-11-14), so the pattern itself is not widened. */
export function matchCalendarEvents(
  def: HolidayPageDef, year: number, candidates: CalendarCandidate[], timeZone: string, exclude: Record<string, string>,
  include: Record<string, string> = {},
): { events: ConfirmedEvent[]; report: CalendarMatchLine[] } {
  const rule = def.calendarMatch;
  if (!rule) return { events: [], report: [] };
  const day = occurrenceDay(def, year);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const first = iso(day - rule.daysBefore * DAY);
  const extend = def.extendTo?.(year) ?? '';
  const last = [iso(day + rule.daysAfter * DAY), extend].sort().pop()!;
  const events: ConfirmedEvent[] = [];
  const report: CalendarMatchLine[] = [];
  for (const { item, nearbyMiles } of candidates) {
    const key = calendarKey(item);
    if (!key || item.sourceKind !== 'story' || !item.occurs_at) continue;
    const title = itemTitle(item);
    const byId = !rule.pattern.test(title) && key in include;
    if (!byId && !rule.pattern.test(title)) continue; // neither a title match nor named by key
    const { date, time } = localParts(item.occurs_at, timeZone);
    if (date < first || date > last) continue;
    if (key in exclude) { report.push({ key, date, title, included: false, reason: exclude[key] }); continue; }
    const venue = venueFromRaw(itemVenue(item));
    const link = itemLink(item);
    if (!venue || !link) { report.push({ key, date, title, included: false, reason: !venue ? 'no venue' : 'no link' }); continue; }
    report.push({ key, date, title, included: true, ...(byId ? { reason: include[key] } : {}) });
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

/** Dated rows of the curated venue register (db.getEveningRegister, the rows /tonight reads) whose title matches the holiday's
 *  pattern and whose day is in the same window as the calendar rows. The /tonight freshness rule applies (a dated row the venue's page
 *  has not shown for REGISTER_MAX_AGE_DAYS.dated days is left out). The same night listed twice by one venue (same day, first start
 *  and showTitleKey) is one row: the one confirmed last. Keys "reg:<venue>|<date>|<title key>" for the report and the excludes. */
export function matchRegisterRows(
  def: HolidayPageDef, year: number, rows: RegisterRow[], nowMs: number, timeZone: string, locality: string, exclude: Record<string, string>,
): { events: ConfirmedEvent[]; report: CalendarMatchLine[] } {
  const rule = def.calendarMatch;
  if (!rule) return { events: [], report: [] };
  const day = occurrenceDay(def, year);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const first = iso(day - rule.daysBefore * DAY);
  const last = [iso(day + rule.daysAfter * DAY), def.extendTo?.(year) ?? ''].sort().pop()!;
  const fresh = rows
    .filter((r) => r.kind === 'dated' && r.onDate && r.onDate >= first && r.onDate <= last && rule.pattern.test(r.title))
    .filter((r) => (nowMs - Date.parse(r.lastConfirmedAt)) / DAY <= REGISTER_MAX_AGE_DAYS.dated)
    .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
  const seen = new Set<string>();
  const events: ConfirmedEvent[] = [];
  const report: CalendarMatchLine[] = [];
  for (const r of fresh) {
    const key = `reg:${r.venueName}|${r.onDate}|${showTitleKey(r.title)}`;
    const night = `${key}|${r.times[0] ?? ''}`;
    if (seen.has(night)) { report.push({ key, date: r.onDate!, title: r.title, included: false, reason: 'same night listed twice' }); continue; }
    seen.add(night);
    if (key in exclude) { report.push({ key, date: r.onDate!, title: r.title, included: false, reason: exclude[key] }); continue; }
    report.push({ key, date: r.onDate!, title: r.title, included: true });
    const venue: EventVenue = { name: r.venueName, locality };
    const details = [
      ...(r.times.length > 1 ? [`Also ${r.times.slice(1).map((t) => formatClock(t, 'en-GB')).join(', ')}.`] : []),
      ...(r.price ? [r.price] : []),
    ];
    events.push({
      status: 'confirmed', name: r.title, date: r.onDate!, venue, url: r.sourceUrl,
      ...(r.times[0] ? { startTime: r.times[0] } : {}),
      ...(details.length ? { details } : {}),
      source: { name: r.venueName, url: r.sourceUrl },
      checkedOn: localParts(r.lastConfirmedAt, timeZone).date,
      fromCalendar: key,
    });
  }
  events.sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));
  return { events, report };
}

/** Ticketmaster events (the build's one memoised fetch, the rows /tonight and /whats-on read; no extra call) whose title matches the
 *  holiday's pattern and whose local day is in the same window as the calendar rows (owner 2026-11-15). Keys "tm:<Ticketmaster id>"
 *  for the report and the excludes. Each row links to its own ticket page (ticketmaster.co.uk or universe.com, as /whats-on does);
 *  the row has its own /whats-on/ page with its markup, so it is marked `fromCalendar` and the holiday page emits no JSON-LD for it. */
export function matchTicketmasterEvents(
  def: HolidayPageDef, year: number, items: TicketmasterFeedItem[], nowMs: number, timeZone: string, exclude: Record<string, string>,
): { events: ConfirmedEvent[]; report: CalendarMatchLine[] } {
  const rule = def.calendarMatch;
  if (!rule) return { events: [], report: [] };
  const day = occurrenceDay(def, year);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const first = iso(day - rule.daysBefore * DAY);
  const last = [iso(day + rule.daysAfter * DAY), def.extendTo?.(year) ?? ''].sort().pop()!;
  const events: ConfirmedEvent[] = [];
  const report: CalendarMatchLine[] = [];
  for (const { occurs_at, ticketmasterEvent: e } of items) {
    if (!occurs_at || !rule.pattern.test(e.title)) continue;
    const { date, time } = localParts(occurs_at, timeZone);
    if (date < first || date > last) continue;
    const key = `tm:${e.id}`;
    if (key in exclude) { report.push({ key, date, title: e.title, included: false, reason: exclude[key] }); continue; }
    if (!e.venueName) { report.push({ key, date, title: e.title, included: false, reason: 'no venue' }); continue; }
    report.push({ key, date, title: e.title, included: true });
    const venue: EventVenue = { name: e.venueName, ...(e.venueAddress ? { street: e.venueAddress } : {}), locality: e.venueCity ?? '' };
    events.push({
      status: 'confirmed', name: e.title, date, venue, url: e.ticketUrl,
      ...(time !== '00:00' ? { startTime: time } : {}),
      source: { name: 'Ticketmaster', url: e.ticketUrl },
      checkedOn: localParts(new Date(nowMs).toISOString(), timeZone).date, // read at this build
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
