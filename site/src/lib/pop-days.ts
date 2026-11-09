/** Flat day rows (further out, nearby, coming up) grouped by their local day, in the order given, so the same date-tile list can print them:
 *  the tile sits on the first row of each day. A pure reshaping; nothing is added or dropped. */
import type { DayGroup, DayRow } from './event-day-view';
import type { FeedItem } from './events';
import { driveLabel, distanceText, type EveningEntry } from './evening-items';
import { eveningCategory } from './pop-categories';
import { showTimeGb } from './whats-on-dates';
import type { WeekRow } from './week-groups';

/** What the date-tile list prints for one row. A DayRow is one (its link comes from `item`); a big show is built straight into one (its link is `href`). */
export type PopRow = Pick<DayRow, 'dayKey' | 'timeLabel' | 'title' | 'venue' | 'area' | 'free' | 'kids' | 'teens' | 'cat' | 'start' | 'end' | 'recurrence'>
  & { /** Where the date tile starts when that is earlier than `start` (a week row that repeats over several days; `start`/`end` stay the LAST occurrence, which is what decides when the row is over). */ tileFrom?: string; item?: FeedItem; href?: string; note?: string; tags?: string[]; /** Extra attributes on the row's <li> (the page's own hooks, e.g. data-group, data-card for /tonight's filters). */ attrs?: Record<string, string | undefined> };
export interface PopDay { dayKey: string; rows: PopRow[] }

export function groupRowsByDay(rows: DayRow[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.dayKey === r.dayKey) { last.rows.push(r); last.count++; continue; }
    out.push({ offset: r.offset, dayKey: r.dayKey, label: '', weekday: '', dateLabel: r.dateLabel, count: 1, rows: [r] });
  }
  return out;
}

/** /tonight and /this-weekend entries as rows of the time-tile list: one day, so one group; "venue · neighbourhood · distance · about N min" as on the old rows. */
export function eveningPopDays(entries: EveningEntry[], tz: string, country: string, attrsOf?: (e: EveningEntry) => Record<string, string | undefined>): PopDay[] {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days: PopDay[] = [];
  for (const e of [...entries].sort((a, b) => a.start.localeCompare(b.start))) {
    const dayKey = key.format(new Date(e.start));
    const row: PopRow = {
      dayKey, timeLabel: '', title: e.title, venue: e.venue, area: [e.area, distanceText(e.distanceMiles, country), driveLabel(e.driveMinutes)].filter(Boolean).join(' · ') || null,
      free: e.labels.includes('Free'), kids: false, teens: false, cat: eveningCategory(e.group), start: e.start, end: e.end, recurrence: 'one_off',
      href: e.href ?? undefined, tags: e.labels.filter((l) => l !== 'Free'),
      note: e.laterStarts?.length ? `Also ${e.laterStarts.map((t) => showTimeGb(t, tz)).join(', ')}` : undefined,
      attrs: attrsOf?.(e),
    };
    const last = days[days.length - 1];
    if (last && last.dayKey === dayKey) last.rows.push(row); else days.push({ dayKey, rows: [row] });
  }
  return days;
}

/** A theme group of the week roundup / university digest as rows of the date-tile list (the tile carries the day, the meta line the clock time). */
export function weekPopDays(rows: WeekRow[], tz: string): PopDay[] {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return groupPop(rows.map((r) => {
    const time = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\ball day\b/i.exec(r.when)?.[0] ?? '';
    return {
      dayKey: key.format(new Date(r.firstStart)), timeLabel: time, tileFrom: r.firstStart !== r.start ? r.firstStart : undefined, title: r.title, venue: r.venue, area: null, free: false, kids: false, teens: false, cat: null,
      start: r.start, end: r.end, recurrence: 'one_off' as const, href: r.href ?? undefined,
    };
  }));
}

function groupPop(rows: PopRow[]): PopDay[] {
  const out: PopDay[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.dayKey === r.dayKey) last.rows.push(r); else out.push({ dayKey: r.dayKey, rows: [r] });
  }
  return out;
}
