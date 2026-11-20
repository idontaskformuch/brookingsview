/** Designsystem Fas 2 (owner 2026-11-20): one entry per real event, before anything is rendered or counted.
 *
 *  Runs after the cross-source feed (event-dedup.mjs buildEventFeedCore). Two passes, both on the town's local calendar:
 *   1. Same day, same place: two listings whose starts are within SAME_EVENT_MINUTES and whose titles overlap (one contains the other's
 *      words, or they are near-identical) are one event; the longer title is kept ("Grace Fromknect Recital" + "Grace Fromknect & Ava
 *      Gibbs Recital"). The same title at the same place at other times that day is one entry with several times ("History Club 20s
 *      Event", 3 PM & 7 PM).
 *   2. Series: the same title at the same place on several days is one entry ("Nov 20–21", "3 dates, Nov 20–22").
 *  "Same place": the venue's name (first comma part, without a leading "The") equal or one containing the other; a listing without a
 *  venue never blocks a same-day match, but a series needs the place on both sides. Two named rooms that differ ("Glasgow Royal Concert
 *  Hall, Strathclyde Suite" / "..., New Auditorium") are two places (event-dedup.mjs venueRoom); a room named on one side only is not.
 *  Pure: no database, no site config. The entry's `occ` is what lib/local-day.ts countEventsToday() counts. */
import { itemTitle, itemVenue, localDateParts, roomsDiffer, venueKey } from './event-dedup.mjs';
import type { FeedItem } from './events';
import { hasEnded, type TimedEvent } from './local-day';

export const SAME_EVENT_MINUTES = 15;

export interface EventEntry {
  /** The listing that represents the entry (the longer title on a same-time merge; the earliest occurrence's listing in a series). */
  item: FeedItem;
  /** The other listings folded into it. */
  merged: FeedItem[];
  /** Every time it happens, in start order. */
  occ: TimedEvent[];
}

const STOPWORDS = new Set(['the', 'a', 'an', 'at', 'of', 'and', 'for', 'in', 'on', 'to', 'with']);

export const normTitle = (t: string) => t.toLowerCase().replace(/&/g, ' and ').replace(/@/g, ' at ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (t: string) => new Set(normTitle(t).split(' ').filter((w) => w && !STOPWORDS.has(w)));

export { venueKey };

/** null = unknown on either side. `raw*` are the venue strings as listed (for the room). */
function venueMatch(a: string | null, b: string | null, rawA: string | null = null, rawB: string | null = null): boolean | null {
  if (roomsDiffer(rawA, rawB)) return false;
  if (!a || !b) return null;
  return a === b || a.includes(b) || b.includes(a);
}

/** One title contains the other's words (at least two), or the two share nearly all their words (Dice >= 0.8). */
export function titlesOverlap(a: string, b: string): boolean {
  if (normTitle(a) === normTitle(b)) return true;
  const ta = tokens(a), tb = tokens(b);
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size >= 2 && [...small].every((w) => large.has(w))) return true;
  const shared = [...ta].filter((w) => tb.has(w)).length;
  return ta.size + tb.size > 0 && Math.min(ta.size, tb.size) >= 2 && (2 * shared) / (ta.size + tb.size) >= 0.8;
}

const iso = (v: string | Date) => new Date(v).toISOString();
const endOf = (item: FeedItem): string | Date | null => (item.sourceKind === 'story' ? item.story.ends_at : item.event.ends_at) ?? null;
const occOf = (item: FeedItem): TimedEvent => {
  const end = endOf(item);
  return { start: iso(item.occurs_at!), end: end ? iso(end) : null };
};

interface Work extends EventEntry { title: string; venue: string | null; raw: string | null; day: string }

function dayOf(start: string, tz: string): string {
  const p = localDateParts(new Date(start), tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Items in start order (undated items are left out: they cannot be on a day). */
export function buildEntries(items: FeedItem[], timezone: string): EventEntry[] {
  const sorted = items.filter((i) => i.occurs_at).sort((a, b) => Date.parse(iso(a.occurs_at!)) - Date.parse(iso(b.occurs_at!)));
  // Pass 1: one day.
  const kept: Work[] = [];
  for (const item of sorted) {
    const o = occOf(item);
    const title = itemTitle(item);
    const raw = itemVenue(item);
    const venue = venueKey(raw);
    const day = dayOf(o.start, timezone);
    const sameDay = kept.filter((k) => k.day === day && venueMatch(k.venue, venue, k.raw, raw) !== false);
    const near = sameDay.find((k) => k.occ.some((x) => Math.abs(Date.parse(x.start) - Date.parse(o.start)) <= SAME_EVENT_MINUTES * 60_000)
      && titlesOverlap(k.title, title));
    if (near) {
      near.merged.push(item);
      if (normTitle(title).length > normTitle(near.title).length) {
        // the longer title represents the entry; the shorter listing becomes a merged one
        near.merged = [near.item, ...near.merged.filter((m) => m !== item)];
        near.item = item;
        near.title = title;
      }
      near.venue ??= venue;
      near.raw ??= raw;
      continue;
    }
    const again = sameDay.find((k) => normTitle(k.title) === normTitle(title));
    if (again) {
      again.merged.push(item);
      again.occ.push(o);
      again.venue ??= venue;
      again.raw ??= raw;
      continue;
    }
    kept.push({ item, merged: [], occ: [o], title, venue, raw, day });
  }
  // Pass 2: the same event on several days.
  const out: Work[] = [];
  for (const w of kept) {
    const series = out.find((k) => k.day !== w.day && normTitle(k.title) === normTitle(w.title) && venueMatch(k.venue, w.venue, k.raw, w.raw) === true);
    if (series) {
      series.merged.push(w.item, ...w.merged);
      series.occ.push(...w.occ);
      continue;
    }
    out.push(w);
  }
  return out.map(({ item, merged, occ }) => ({ item, merged, occ: occ.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) }));
}

/** The occurrence a list places the entry by: the first not ended at `now`, else the last. */
export function shownOccurrence(e: EventEntry, now: Date, timezone: string): TimedEvent {
  return e.occ.find((o) => !hasEnded(o, now, timezone)) ?? e.occ[e.occ.length - 1];
}

/** Distinct town days of the entry, in order. */
export function entryDays(e: EventEntry, timezone: string): string[] {
  return [...new Set(e.occ.map((o) => dayOf(o.start, timezone)))];
}

/** "3 PM & 7 PM", "1 PM, 3 PM & 7 PM": the times on one day, each from `clock`. */
export function joinTimes(labels: string[]): string {
  const u = [...new Set(labels.filter(Boolean))];
  if (u.length <= 1) return u[0] ?? '';
  return `${u.slice(0, -1).join(', ')} & ${u[u.length - 1]}`;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A series' dates: two days in a row "Nov 20–21" (gb "20–21 Nov"); otherwise "3 dates, Nov 20–22" / "2 dates, Nov 30 – Dec 7".
 *  null for one day. `days` are "YYYY-MM-DD" town days in order. */
export function seriesLabel(days: string[], gb: boolean): string | null {
  if (days.length < 2) return null;
  const [y1, m1, d1] = days[0].split('-').map(Number);
  const [y2, m2, d2] = days[days.length - 1].split('-').map(Number);
  const a = MONTH[m1 - 1], b = MONTH[m2 - 1];
  const range = m1 === m2 && y1 === y2
    ? (gb ? `${d1}–${d2} ${a}` : `${a} ${d1}–${d2}`)
    : (gb ? `${d1} ${a} – ${d2} ${b}` : `${a} ${d1} – ${b} ${d2}`);
  const consecutive = days.length === 2 && Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1) === 86_400_000;
  return consecutive ? range : `${days.length} dates, ${range}`;
}

/** The entry in the browser's terms: its occurrences (lib/local-day.ts CountableEntry). */
export function countable(e: EventEntry, nearby = false): { occ: TimedEvent[]; nearby?: boolean } {
  return nearby ? { occ: e.occ, nearby: true } : { occ: e.occ };
}
