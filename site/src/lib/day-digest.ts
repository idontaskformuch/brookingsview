/** Day blocks for event lists (owner 2026-11-26 (7), rollout a: /events/ and /this-week/, every town through shared components).
 *  The pattern from the Christmas page (.claude/standards.md "Mönster för helg- och dagsidor"): each day opens with a digest line
 *  ("6 events · 2 music · 3 free"), then ONE featured event as a larger card, then compact rows, at most MAX_COMPACT before "N more".
 *  Pure: rows in, words out; every word comes from the rows' own data (count, category, a stated "Free"). */
import { CATEGORY_LABEL, type EventRowData } from './event-row';
import type { Category } from './ui/ui-helpers';

/** Compact rows under the featured card before the rest folds behind "N more" (principle 4: about five alike in a row). */
export const MAX_COMPACT = 5;
/** Categories named in a digest line, most first. */
export const MAX_DIGEST_CATEGORIES = 2;

type DigestRow = Pick<EventRowData, 'category' | 'extra'>;

/** A category as a counted word: the row label in lower case ("2 arts", "1 food & drink"); "civic" alone does not count ("1 civic"),
 *  so it is "1 civic event" / "2 civic events". */
const digestWord = (c: Category, n: number): string => (c === 'civic' ? `civic ${n === 1 ? 'event' : 'events'}` : CATEGORY_LABEL[c].toLowerCase());

/** "6 events · 2 music · 3 free · +12 nearby": the town's count, its commonest categories (only when the day mixes them), how many say
 *  Free, then the day's rows in other towns as a separate count (owner 2026-11-26 (9): "4 events · +12 nearby"). `rows` are the town's
 *  own only. A day of one town row and nothing nearby has no digest: "1 event" over the one row says nothing the row does not. */
export function eventDigest(rows: DigestRow[], nearby = 0): string {
  if (rows.length < 2 && nearby === 0) return '';
  const parts = rows.length > 0 ? [`${rows.length} ${rows.length === 1 ? 'event' : 'events'}`] : [];
  const tail = nearby > 0 ? [`+${nearby} nearby`] : [];
  if (rows.length < 2) return [...parts, ...tail].join(' · ');
  const tally = new Map<Category, number>();
  for (const r of rows) if (r.category) tally.set(r.category, (tally.get(r.category) ?? 0) + 1);
  if (tally.size > 1) {
    const order = [...tally.entries()].sort((a, b) => b[1] - a[1] || CATEGORY_LABEL[a[0]].localeCompare(CATEGORY_LABEL[b[0]]));
    for (const [c, n] of order.slice(0, MAX_DIGEST_CATEGORIES)) parts.push(`${n} ${digestWord(c, n)}`);
  }
  const free = rows.filter((r) => r.extra.some((x) => /^free\b/i.test(x))).length;
  if (free > 0) parts.push(`${free} free`);
  return [...parts, ...tail].join(' · ');
}

/** Rows in a day's Nearby block (owner 2026-11-26 (9)): "Nearby i ett eget avgränsat block sist, max 3 per dag". */
export const NEARBY_PER_DAY = 3;
/** Towns named in the block's heading before "…". */
export const NEARBY_HEADING_TOWNS = 3;

/** The day's Nearby block: own events in other towns before ticket listings (each in time order), the first NEARBY_PER_DAY shown; the
 *  rest split into own events (a fold on the page: they are not on What's On) and ticket listings (counted; "More nearby shows →" goes
 *  to What's On). `heading`: "Nearby · Denver, Boulder, Arvada…" from the shown and hidden rows' towns, in order of first appearance. */
export function splitNearby<T extends Pick<EventRowData, 'nearby'>>(rows: T[]): { heading: string; shown: T[]; moreOwn: T[]; moreTickets: number } {
  const ordered = [...rows.filter((r) => !r.nearby?.ticket), ...rows.filter((r) => r.nearby?.ticket)];
  const shown = ordered.slice(0, NEARBY_PER_DAY);
  const rest = ordered.slice(NEARBY_PER_DAY);
  const towns = [...new Set(ordered.flatMap((r) => (r.nearby?.city ? [r.nearby.city] : [])))];
  const heading = towns.length === 0 ? 'Nearby'
    : `Nearby · ${towns.slice(0, NEARBY_HEADING_TOWNS).join(', ')}${towns.length > NEARBY_HEADING_TOWNS ? '…' : ''}`;
  return { heading, shown, moreOwn: rest.filter((r) => !r.nearby?.ticket), moreTickets: rest.filter((r) => r.nearby?.ticket).length };
}

/** A row that repeats (a weekly class, a run of dates, "Regular"): never the day's featured card while a one-off exists. */
export const RECURRING = /\b(weekly|monthly|daily|regular|every|dates?)\b/i;
export const isRecurring = (r: Pick<EventRowData, 'extra' | 'recurring'>): boolean => !!r.recurring || r.extra.some((x) => RECURRING.test(x));

/** A run over several days (an exhibition, a panto season): its stated end is more than a day and a half after its start. */
export const isRun = (r: Pick<EventRowData, 'start' | 'end'>): boolean =>
  !!r.start && !!r.end && Date.parse(r.end) - Date.parse(r.start) > 36 * 3_600_000;

type FeatureRow = Pick<EventRowData, 'href' | 'extra' | 'start' | 'end' | 'recurring'>;

/** The day's featured row, as an index into `rows` (or -1 for none). In order: a row the caller marks as top (`isTop`: the town's top
 *  events); the first one-off with a link (not repeating, not a run of days); else the first run with a link. A repeating row (a
 *  weekly class) is never featured, and a day of one row has no card (one row is just a row). Rows come sorted by time, so "first" is
 *  the earliest. */
export function featuredIndex<T extends FeatureRow>(rows: T[], isTop: (r: T) => boolean = () => false): number {
  if (rows.length < 2) return -1;
  const top = rows.findIndex((r) => isTop(r) && r.href);
  if (top >= 0) return top;
  const oneOff = rows.findIndex((r) => !!r.href && !isRecurring(r) && !isRun(r));
  if (oneOff >= 0) return oneOff;
  return rows.findIndex((r) => !!r.href && !isRecurring(r));
}

/** A day split for the block: the featured row, the compact rows shown, and the ones behind "N more". */
export function splitDay<T extends FeatureRow>(rows: T[], isTop?: (r: T) => boolean): { featured: T | null; shown: T[]; more: T[] } {
  const i = featuredIndex(rows, isTop);
  const rest = i < 0 ? rows : rows.filter((_, j) => j !== i);
  return { featured: i < 0 ? null : rows[i], shown: rest.slice(0, MAX_COMPACT), more: rest.slice(MAX_COMPACT) };
}
