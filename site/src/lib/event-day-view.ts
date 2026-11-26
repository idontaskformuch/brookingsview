/** /events/ as an answer: how many things are on today, which days are busy, what is on each day.
 *
 *  Pure functions of (items, now, timezone). Every date here is the TOWN's local calendar day, taken from the event's start instant;
 *  nothing reads a date out of the story text (the stored AI text of a 19:00 Pacific event can name the UTC day, see
 *  bodyNamesWrongDay). Day arithmetic goes through localDateParts/dayIndex in events.ts, the one primitive every events page shares. */
import { localDateParts, utcMidnight, dayIndex, type FeedItem } from './events';
import { isAllDay, localHourOf, TONIGHT_FROM_HOUR, countEventsToday, eventEndsAt, type TimedEvent } from './local-day';
import { buildEntries, shownOccurrence, entryDays, joinTimes, seriesLabel, countable, normTitle, type EventEntry } from './event-entries';
import type { Story } from './db';
import type { Category } from './ui/ui-helpers';
import { shortDateOfDay, shortWeekdayOfDay } from './calendar-strings';

/** Days listed one by one on the page; later items go to `furtherOut`. */
export const DAY_WINDOW = 7;
/** The day strip is a navigation aid; with fewer events in the window it is noise (standard layout: fewer than 5 hides it). */
export const DAYSTRIP_MIN_EVENTS = 5;
// Dedup and series merging are lib/event-entries.ts (Designsystem Fas 2, owner 2026-11-20); the old ±60 min same-title pass is gone.
export { normTitle };

export type Recurrence = 'one_off' | 'weekly' | 'monthly' | 'regular';

/** What the page needs to know about one item that does not come from its start time. Built by the page (venue registry, areas). */
export interface RowFacts {
  title: string;
  venue: string | null;
  area: string | null;
  free: boolean;
  kids: boolean;
  /** the source states a teen audience (never guessed from the title) */
  teens?: boolean;
  cat?: Category | null;
  /** the other town the venue's own address names (lib/place-locality.ts); every row then says "Nearby · <town>" */
  elsewhere?: string | null;
}

export interface DayRow {
  item: FeedItem;
  dayKey: string;
  /** "Nov 10" (us) / "10 Nov" (gb). */
  dateLabel: string;
  offset: number;
  timeLabel: string;
  allDay: boolean;
  tonight: boolean;
  recurrence: Recurrence;
  title: string;
  venue: string | null;
  area: string | null;
  free: boolean;
  kids: boolean;
  teens: boolean;
  cat: Category | null;
  start: string;
  end: string | null;
  /** the other listings of the same event (lib/event-entries.ts): merged into this row */
  merged: FeedItem[];
  /** every time the event happens (several times a day, or a series over several days) */
  occ: TimedEvent[];
  /** a series over several days: "Nov 20–21" / "3 dates, Nov 20–22"; null for one day */
  seriesLabel: string | null;
}

export interface DayGroup {
  offset: number;
  dayKey: string;
  /** "Today", "Tomorrow", then the short weekday ("Thu"): the heading above the day's list. */
  label: string;
  /** The short weekday ("Thu") for every day, today included: the day strip uses this, never "Today"/"Tomorrow" cut to three letters. */
  weekday: string;
  /** "Nov 10" (us) / "10 Nov" (gb). */
  dateLabel: string;
  count: number;
  rows: DayRow[];
}

export interface EventsView {
  days: DayGroup[];
  furtherOut: DayRow[];
  total: number;
  todayCount: number;
  tonightCount: number;
  freeToday: number;
  /** First day after today with events, for the "nothing today" line. */
  nextDay: DayGroup | null;
  showDayStrip: boolean;
}

interface Options {
  now: Date;
  timezone: string;
  gb: boolean;
  facts: (item: FeedItem) => RowFacts;
}

const iso = (v: string | Date) => new Date(v).toISOString();

function dayKeyOf(day: { y: number; m: number; d: number }): string {
  return `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
}

/** "7 PM" / "7:30 PM" (US), "7pm" / "7:30pm" (gb), local to `timezone`. All-day items: "All day" on the US sites, '' on gb
 *  (Glasgow Life lists a date and no time for some events; the page shows the day only, owner 2026-10-27). */
export function clockLabel(start: string | Date, end: string | Date | null | undefined, timezone: string, gb: boolean): string {
  const s = iso(start);
  if (isAllDay({ start: s, end: end ? iso(end) : null }, timezone)) return gb ? '' : 'All day';
  const p = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(s));
  const hour = Number(p.find((x) => x.type === 'hour')!.value) % 24;
  const minute = Number(p.find((x) => x.type === 'minute')!.value);
  const h12 = hour % 12 || 12;
  const ap = hour < 12 ? 'AM' : 'PM';
  if (gb) return `${h12}${minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`}${ap.toLowerCase()}`;
  return `${h12}${minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`} ${ap}`;
}

/** The structured cost line ("Free", "Free, ticket required", "£23.90 ...") decides when the source gave one: true / false.
 *  No cost field -> null, so the caller falls back to the venue rule. "Freestyle workshop" is not free: the word must stand alone. */
export function isFreeByCost(cost: string | null | undefined): boolean | null {
  const c = (cost ?? '').trim();
  if (!c) return null;
  return /^free\b(?![-\w])/i.test(c);
}

export function recurrenceKind(story: Pick<Story, 'is_recurring_series'> & { meta?: { recurrence?: string | null } | null }): Recurrence {
  if (!story.is_recurring_series) return 'one_off';
  const r = (story.meta?.recurrence ?? '').toLowerCase();
  if (/every\s+(\d+\s+)?weeks?|weekly/.test(r)) return 'weekly';
  if (/month/.test(r)) return 'monthly';
  return 'regular';
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})\\b`, 'gi');

/** True when stored text names the event's UTC calendar day and not its local one (a 16:00 Pacific event written up as "December 8").
 *  Same-day events (local day == UTC day) can never be wrong. Used by the QA check over live rows; the page does not print the text. */
export function bodyNamesWrongDay(body: string, startIso: string, timezone: string): boolean {
  const start = new Date(startIso);
  const local = localDateParts(start, timezone);
  const utc = { y: start.getUTCFullYear(), m: start.getUTCMonth() + 1, d: start.getUTCDate() };
  if (local.m === utc.m && local.d === utc.d) return false;
  const named = new Set<string>();
  for (const m of body.matchAll(MONTH_RE)) named.add(`${MONTHS.indexOf(m[1].toLowerCase()) + 1}-${Number(m[2])}`);
  return named.has(`${utc.m}-${utc.d}`) && !named.has(`${local.m}-${local.d}`);
}

function dayLabelFor(offset: number, day: Date, country: 'us' | 'gb'): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return shortWeekdayOfDay(day, country);
}

const isEntry = (x: FeedItem | EventEntry): x is EventEntry => 'occ' in x;

/** Counted in the page's numbers ("N things on today", the day strip, tonight, free). Owner 2026-11-26: Ticketmaster listings are in the
 *  lists, not in the counts (the 2026-11-06 rule "a big show is never counted with the town's own events" kept for every counter). */
export const isOwnEvent = (item: FeedItem): boolean => item.sourceKind !== 'ticketmaster';

/** `items` are feed items (deduplicated here, lib/event-entries.ts buildEntries) or entries already built by the caller. */
export function buildEventsView(input: FeedItem[] | EventEntry[], { now, timezone, gb, facts }: Options): EventsView {
  const entries: EventEntry[] = input.length > 0 && isEntry(input[0]) ? (input as EventEntry[]) : buildEntries(input as FeedItem[], timezone);
  const today = utcMidnight(localDateParts(now, timezone));
  const country = gb ? 'gb' : 'us';
  const days: DayGroup[] = Array.from({ length: DAY_WINDOW }, (_, offset) => {
    const day = new Date(today.getTime() + offset * 86_400_000);
    return {
      offset,
      dayKey: dayKeyOf({ y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate() }),
      label: dayLabelFor(offset, day, country),
      weekday: shortWeekdayOfDay(day, country),
      dateLabel: shortDateOfDay(day, country),
      count: 0,
      rows: [],
    };
  });
  const furtherOut: DayRow[] = [];

  const placed = entries
    .map((e) => ({ e, o: shownOccurrence(e, now, timezone) }))
    .sort((a, b) => Date.parse(a.o.start) - Date.parse(b.o.start));
  for (const { e, o } of placed) {
    const { item } = e;
    const start = o.start;
    const offset = dayIndex(start, today, timezone);
    if (offset < 0) continue;
    const f = facts(item);
    const local = localDateParts(new Date(start), timezone);
    const days_ = entryDays(e, timezone);
    const sameDay = e.occ.filter((x) => dayIndex(x.start, today, timezone) === offset);
    const series = seriesLabel(days_, gb);
    const last = e.occ[e.occ.length - 1];
    const others = e.merged.map((m) => facts(m));
    const row: DayRow = {
      item, dayKey: dayKeyOf(local), offset,
      dateLabel: shortDateOfDay(utcMidnight(local), country),
      timeLabel: sameDay.length > 1 ? joinTimes(sameDay.map((x) => clockLabel(x.start, x.end, timezone, gb))) : clockLabel(start, o.end, timezone, gb),
      allDay: isAllDay(o, timezone),
      tonight: offset === 0 && localHourOf(new Date(start), timezone) >= TONIGHT_FROM_HOUR,
      recurrence: item.sourceKind === 'story' ? recurrenceKind(item.story) : 'one_off',
      title: f.title, venue: f.venue ?? others.find((x) => x.venue)?.venue ?? null, area: f.area ?? others.find((x) => x.area)?.area ?? null,
      free: f.free || others.some((x) => x.free), kids: f.kids || others.some((x) => x.kids), teens: !!f.teens, cat: f.cat ?? null,
      // A row stays on the page until the event's last time is over (the browser's sweep reads `end`).
      start, end: e.occ.length > 1 ? eventEndsAt(last, timezone).toISOString() : (o.end ?? null),
      merged: e.merged, occ: e.occ, seriesLabel: series,
    };
    if (offset >= DAY_WINDOW) { furtherOut.push(row); continue; }
    days[offset].rows.push(row);
    if (isOwnEvent(item)) days[offset].count++;
  }

  const todayRows = days[0].rows.filter((r) => isOwnEvent(r.item));
  return {
    days,
    furtherOut,
    total: days.reduce((n, d) => n + d.count, 0) + furtherOut.filter((r) => isOwnEvent(r.item)).length,
    // THE count (lib/local-day.ts countEventsToday); the caller passes one zone at a time, so every entry here counts as `town`.
    todayCount: countEventsToday(entries.filter((e) => isOwnEvent(e.item)).map((e) => countable(e)), now, timezone).town,
    tonightCount: todayRows.filter((r) => r.tonight).length,
    freeToday: todayRows.filter((r) => r.free).length,
    nextDay: days.slice(1).find((d) => d.count > 0) ?? null,
    showDayStrip: days.reduce((n, d) => n + d.count, 0) >= DAYSTRIP_MIN_EVENTS,
  };
}

/** Keep the first `max` rows over a list of days (day order, then time), dropping days that end up empty. `hidden` is what was cut. */
export function takeRows(days: DayGroup[], max: number): { days: DayGroup[]; hidden: number } {
  let left = max;
  const out: DayGroup[] = [];
  let hidden = 0;
  for (const d of days) {
    if (d.rows.length === 0) continue;
    if (left <= 0) { hidden += d.rows.length; continue; }
    const rows = d.rows.slice(0, left);
    hidden += d.rows.length - rows.length;
    left -= rows.length;
    out.push({ ...d, rows, count: rows.length });
  }
  return { days: out, hidden };
}

/** Front page blocks from one view: today, the weekend days still ahead (Fri/Sat/Sun, today excluded), the other days of the window, and
 *  later. Each event is in exactly one block, so the page never lists it twice. `weekendAnchor` = weekendAnchorOffset(today) from events.ts. */
export function homeBlocks(view: EventsView, weekendAnchor: number): { today: DayGroup[]; weekend: DayGroup[]; week: DayGroup[]; later: DayRow[] } {
  const isWeekend = (d: DayGroup) => d.offset >= weekendAnchor && d.offset <= weekendAnchor + 2;
  const ahead = view.days.filter((d) => d.offset > 0);
  return {
    today: view.days.filter((d) => d.offset === 0 && d.count > 0),
    weekend: ahead.filter((d) => isWeekend(d) && d.count > 0),
    week: ahead.filter((d) => !isWeekend(d) && d.count > 0),
    later: view.furtherOut,
  };
}
