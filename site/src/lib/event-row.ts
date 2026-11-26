/** Designsystem Fas 1 (owner 2026-11-20): ONE event row and ONE day group for every list (components/ui/EventRow.astro, DayGroup.astro).
 *  This file turns each kind of listing into the same row data, so the components never branch on where a row came from:
 *   - a feed item (a town/library event story, or an SDSU arts event): lib/events.ts FeedItem. Title, venue and category come from
 *     lib/event-row-facts.ts makeRowFacts, the same facts /events/ uses (one venue rule, one category rule).
 *   - a Ticketmaster listing (What's On, Today's shows in Glasgow)
 *  A row is: time on the left, title, place. The day is never on the row; it is the DayGroup heading above it (dayKey/dayLabel). Category
 *  only when the caller's list mixes categories (mixedCategories). Data and template strings only, no prose. Country differences come
 *  from rowEnvFor (the country profile), never from a branch here. */
import { eventPriceAgeLine, type FeedItem } from './events';
import type { DayRow, RowFacts } from './event-day-view';
import { linkTarget } from './ai-text';
import { eventClock, seriesKicker } from './time';
import { distanceLabel, type TicketmasterFeedItem } from './ticketmaster';
import { ticketmasterHref, TICKET_LINK_REL } from './whats-on';
import { runLabel, showDate } from './whats-on-dates';
import { forCountry, type CountryId } from './country-profile';
import type { TodayShow } from './today-shows';
import type { Category } from './ui/ui-helpers';

export interface EventRowData {
  /** ISO instants (data-start / data-end: the browser's bucket and sweep scripts read them). */
  start: string | null;
  end: string | null;
  /** The row's own calendar day "YYYY-MM-DD" when the source states it (Ticketmaster localDate); else the town day of `start`. */
  day?: string | null;
  /** "7:30 PM" / "7pm" / "All day"; '' when no time is known (the time column stays, empty). */
  time: string;
  title: string;
  href: string | null;
  /** rel for an outside link (ticket pages: TICKET_LINK_REL; other sites: noopener); null for our own pages. */
  rel: string | null;
  /** Where: the venue, then (Ticketmaster) the distance label. Joined with " · ". */
  place: string[];
  /** Extra facts after the place: a run's dates ("6 dates, ..."), a series pattern ("Weekly"), a price/age line. */
  extra: string[];
  /** The library category (lib/event-category.ts); shown only when the list mixes categories. */
  category: Category | null;
  /** The source marks it as repeating while no extra says so (the /this-week/ rows); read by lib/day-digest.ts isRecurring. */
  recurring?: boolean;
  /** In another town within the nearby radius (owner 2026-11-26 (9)): listed in the day's own Nearby block, never featured, counted
   *  apart in the digest. `city`: the venue's town as its source states it; `ticket`: a Ticketmaster listing (its rest goes to What's On). */
  nearby?: { city: string | null; ticket: boolean };
}

export interface RowEnv {
  tz: string;
  cityName: string;
  now: Date;
  /** The date style of dayLabel (us: "Sat, Nov 21", gb: "Sat 21 Nov"). */
  country: CountryId;
  /** The 7pm clock (gb) instead of 7 PM (us). */
  lowerClock: boolean;
  /** What an all-day item's time column says ('' = nothing claimed; db.ts allDayWord). */
  allDayLabel: string;
  /** A recurring series' stored start is only its next date (gb sources): show the pattern, never a claimed end. */
  seriesPattern: boolean;
}

export function rowEnvFor(c: { timezone: string; cityName: string; country?: CountryId }, now: Date): RowEnv {
  return {
    tz: c.timezone, cityName: c.cityName, now, country: c.country ?? 'us',
    lowerClock: forCountry(c.country, false, true), allDayLabel: forCountry(c.country, 'All day', ''), seriesPattern: forCountry(c.country, false, true),
  };
}

export { CATEGORY_LABEL } from './category-label';

const iso = (v: string | Date | null | undefined): string | null => (v == null ? null : new Date(v).toISOString());

/** The town's calendar day of an instant, "YYYY-MM-DD": the DayGroup a row belongs to. */
export function dayKey(start: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start));
}

/** A DayGroup heading: "Sat, Nov 21" (us) / "Sat 21 Nov" (gb), with the year only outside the current year. An absolute date, never
 *  "Today"/"Tomorrow" (the page can be half a day old). */
export function dayLabel(start: string | Date, tz: string, now: Date, country: CountryId): string {
  return showDate(new Date(start).toISOString(), tz, now, true, country);
}

/** A DayGroup heading for a calendar day "YYYY-MM-DD" (noon UTC of that date, read as UTC: no zone can move it). The year rule is the
 *  town's current year. */
export function labelOfDay(ymd: string, now: Date, country: CountryId, tz: string): string {
  const thisYear = dayKey(now, tz).slice(0, 4);
  const label = showDate(`${ymd}T12:00:00Z`, 'UTC', new Date(`${thisYear}-07-01T12:00:00Z`), true, country);
  return label;
}

/** A feed item (lib/events.ts) as a row. `facts` is lib/event-row-facts.ts makeRowFacts (title without the venue prefix, the venue). */
export function rowFromFeedItem(item: FeedItem, env: RowEnv, facts: (item: FeedItem) => RowFacts): EventRowData {
  const f = facts(item);
  if (item.sourceKind === 'ticketmaster') {
    // Day and clock as Ticketmaster lists them (localDate/localTime, owner 2026-11-20); title, venue and category from the facts. No price:
    // every town hides prices in its lists (eveningLayer.cards.hidePrice).
    const tm = rowFromTicketmaster(item, env);
    return { ...tm, title: f.title, place: f.venue ? [f.venue] : [], extra: [], category: f.cat ?? null };
  }
  if (item.sourceKind === 'arts') {
    const href = item.event.event_url || null;
    return {
      start: iso(item.occurs_at), end: iso(item.event.ends_at), title: f.title,
      time: item.occurs_at ? eventClock(item.occurs_at, env.tz, item.event.ends_at, env.allDayLabel, env.lowerClock) : '',
      href, rel: href ? 'noopener' : null, place: f.venue ? [f.venue] : [], extra: [], category: f.cat ?? null,
    };
  }
  const s = item.story;
  const href = linkTarget(s);
  const series = env.seriesPattern && Boolean(s.is_recurring_series);
  const when = s.occurs_at;
  return {
    start: iso(when), end: iso(s.ends_at),
    time: when ? eventClock(when, env.tz, series ? null : s.ends_at, env.allDayLabel, env.lowerClock) : '',
    title: f.title, href, rel: href && !href.startsWith('/') ? 'noopener' : null,
    // A venue in another town says so on every list (owner 2026-11-26), not only where the row has an area slot.
    place: [f.venue, f.elsewhere ? `Nearby · ${f.elsewhere}` : null].filter((v): v is string => !!v),
    // Under a day heading the series' weekday is already said: "Weekly · Wed" -> "Weekly".
    extra: [series && when ? seriesKicker(s.meta?.recurrence, when, env.tz).replace(/ · \S+$/, '') : null, eventPriceAgeLine(s)]
      .filter((v): v is string => !!v),
    category: f.cat ?? null,
  };
}

/** A /events/ day row (lib/event-day-view.ts DayRow: its occurrence, its times already joined "3 PM & 7 PM", a series' dates) as an
 *  EventRow (Fas 4, owner 2026-11-21). Link, category and price/age line from the feed item, as on Today; what the old card said as
 *  pills (Free, Kids & families, Teens) and its ↻ ("Repeats weekly") go after the place. `place` replaces the area (Nearby: "4 mi away"). */
export function rowFromDayRow(r: DayRow, env: RowEnv, facts: (item: FeedItem) => RowFacts, place?: string | null): EventRowData {
  const base = rowFromFeedItem(r.item, env, facts);
  const extra = [r.seriesLabel, ...base.extra];
  if (r.recurrence === 'weekly' || r.recurrence === 'monthly') {
    const word = r.recurrence === 'weekly' ? 'Weekly' : 'Monthly';
    if (!extra.includes(word)) extra.push(word);
  }
  if (r.free && !extra.some((x) => x && /\bfree\b/i.test(x))) extra.push('Free');
  if (r.kids && !extra.some((x) => x && /\bkids\b/i.test(x))) extra.push('Kids & families');
  if (r.teens && !extra.some((x) => x && /\bteens?\b/i.test(x))) extra.push('Teens');
  // A Ticketmaster row keeps the clock Ticketmaster lists (never re-derived from the UTC instant), unless the day joins several times.
  const tm = r.item.sourceKind === 'ticketmaster' && !r.timeLabel.includes('&');
  return {
    ...base, start: r.start, end: r.end, day: tm ? (base.day ?? r.dayKey) : r.dayKey, time: tm ? base.time : r.timeLabel, title: r.title,
    place: [r.venue, place ?? r.area].filter((v): v is string => !!v),
    extra: extra.filter((v): v is string => !!v),
  };
}

/** A Ticketmaster show on Today (lib/today-shows.ts: shows in the city itself). */
export function rowFromTodayShow(show: TodayShow, cityName: string): EventRowData {
  return {
    start: show.start, end: show.end, time: show.clock, title: show.title, href: show.href, rel: show.href ? TICKET_LINK_REL : null,
    place: [show.venue, `In ${cityName}`], extra: [], category: null,
  };
}

/** "20:00:00" -> "8 PM" (us) / "8pm" (gb): Ticketmaster's own local clock, no time-zone arithmetic. '' for none, and for 00:00 (how a
 *  date-only listing arrives: no time is claimed). */
export function clockFromLocalTime(localTime: string | null | undefined, lowerClock: boolean): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(localTime ?? '');
  if (!m) return '';
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour === 0 && minute === 0) return '';
  const h12 = hour % 12 || 12;
  const mm = minute ? `:${String(minute).padStart(2, '0')}` : '';
  return lowerClock ? `${h12}${mm}${hour < 12 ? 'am' : 'pm'}` : `${h12}${mm} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** A What's On listing; a collapsed run (runSize > 1) keeps its first date as the row's day and says the run in `extra` (no single
 *  time is claimed for a run). The day and time are the venue's own localDate/localTime; only a listing without them falls back to the
 *  UTC instant in the town's zone. A listing with no real time (local midnight) shows none. */
export function rowFromTicketmaster(item: TicketmasterFeedItem, env: RowEnv, runSize = 1, lastOccursAt: string | null = null): EventRowData {
  const e = item.ticketmasterEvent;
  const href = ticketmasterHref(e);
  const run = runSize > 1 && item.occurs_at && lastOccursAt ? runLabel(runSize, item.occurs_at, lastOccursAt, env.tz, env.now, env.country) : null;
  return {
    start: iso(item.occurs_at), end: null, day: e.localDate ?? null,
    time: run ? '' : e.localTime ? clockFromLocalTime(e.localTime, env.lowerClock)
      : item.occurs_at && !e.localDate ? eventClock(item.occurs_at, env.tz, null, '', env.lowerClock) : '',
    title: e.title, href, rel: href ? TICKET_LINK_REL : null,
    place: [e.venueName ?? 'Venue TBA', distanceLabel(e.venueDistanceMiles, env.cityName)].filter((v): v is string => !!v),
    extra: [run, e.priceRangeText].filter((v): v is string => !!v),
    category: null,
  };
}

/** True when the rows carry more than one category: only then does a row print its category. */
export function mixedCategories(rows: Pick<EventRowData, 'category'>[]): boolean {
  return new Set(rows.map((r) => r.category).filter(Boolean)).size > 1;
}

/** `rows`: the town's own; `nearby`: the day's rows in other towns, shown last in their own block (owner 2026-11-26 (9)). */
export interface DayGroupData<T> { key: string; label: string; rows: T[]; nearby?: T[] }

/** Rows grouped under one heading per town day, in the order the rows come in (callers sort by date). Rows without a start go in a
 *  last group with an empty key and label (the caller decides how to head it). */
export function groupByDay<T extends { start: string | null; day?: string | null }>(rows: T[], env: Pick<RowEnv, 'tz' | 'now' | 'country'>): DayGroupData<T>[] {
  const groups: DayGroupData<T>[] = [];
  const byKey = new Map<string, DayGroupData<T>>();
  for (const r of rows) {
    const key = r.day ?? (r.start ? dayKey(r.start, env.tz) : '');
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: key ? labelOfDay(key, env.now, env.country, env.tz) : '', rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  return [...groups.filter((g) => g.key !== ''), ...groups.filter((g) => g.key === '')];
}
