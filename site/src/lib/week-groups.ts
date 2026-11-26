/** Theme groups for the weekly page (owner restructure, 2026-10-23): under a short AI introduction the
 *  week is a DETERMINISTIC list, grouped by theme, one line per item: "Fri 7pm · Volleyball vs South Dakota",
 *  each linked to the event page. Nothing here is written by a model, and the day and time only ever
 *  appear in these lines, never in the introduction. Empty themes are omitted.
 *
 *  Order of work (owner corrections, 2026-10-23):
 *    1. quorum notices ("Notice: possible quorum ...") are dropped: not something a resident attends;
 *    2. sport titles are normalized ("Volleyball vs South Dakota", "Football vs Murray State");
 *    3. rows listed twice (same day and time, compatible venue, one title contained in the other) are merged;
 *    4. a recurring item on several days becomes one row with a day interval ("Fri–Sun 8am");
 *    5. the site's top events (siteConfig.topEvents, e.g. Hobo Day) get their own first group, "Big this week";
 *    6. everything else is grouped by theme from its vertical, title, venue and source categories by plain
 *       keyword rules, first match wins. An item that matches no rule lands in "Around town": the grouping
 *       can only under-describe an item, never invent a fact. */
import { isAllDay, localMidnightIso } from './local-day';
import { formatClockCompact } from './country-profile';
import type { DayBucket, DayItem } from './this-week';
import { otherTownOf } from './place-locality';
import type { DayGroupData, EventRowData } from './event-row';
import type { Category } from './ui/ui-helpers';
import { categorize } from './event-category';

export type ThemeId =
  | 'big' | 'city' | 'campus' | 'music' | 'arts' | 'library' | 'family' | 'outdoors' | 'food' | 'sports' | 'community';

/** Display order of the groups. */
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'big', label: 'Big this week' },
  { id: 'city', label: 'City meetings and projects' },
  { id: 'campus', label: 'Campus and student life' },
  { id: 'music', label: 'Music' },
  { id: 'arts', label: 'Arts, theater and gardens' },
  { id: 'library', label: 'Library' },
  { id: 'family', label: 'Family and kids' },
  { id: 'outdoors', label: 'Outdoors and recreation' },
  { id: 'food', label: 'Food and markets' },
  { id: 'sports', label: 'Sports' },
  { id: 'community', label: 'Around town' },
];

const RULES: { id: ThemeId; re: RegExp }[] = [
  { id: 'music', re: /\b(concert|recital|choir|chorale|orchestra|symphon\w*|band|jazz|ensemble|musical|music|karaoke|singers?)\b/i },
  { id: 'sports', re: /\b(football|basketball|hockey|volleyball|soccer|wrestling|softball|baseball|tournament|jackrabbits?|jacks club)\b/i },
  { id: 'arts', re: /\b(art|arts|gallery|exhibit\w*|theatre|theater|dance|film|movie|garden\w*|museum|pottery|painting|craft|opera)\b/i },
  { id: 'library', re: /\b(library|story ?time)\b/i },
  { id: 'food', re: /\b(market|farmers|breakfast|pancake|dinner|brew\w*|tasting|food|bake\w*|cookie|supper|lunch|coffee|ice cream)\b/i },
  { id: 'family', re: /\b(kids?|children|childrens?|toddler|preschool|family|youth|teens?|tween)\b/i },
  { id: 'outdoors', re: /\b(hike|hiking|trail|nature|fishing|birding|bird|kayak|snowshoe|ski|skating|5k|run|walk)\b/i },
];

type ThemeInput = Pick<DayItem, 'vertical' | 'title'> & Partial<Pick<DayItem, 'venue' | 'categories'>>;

/** A sports fixture: the sports vertical, an "SDSU ..."/"Jackrabbits ..." title, an athletics-category event, or a
 *  "<sport code> vs <opponent>" title from the SDSU feed ("VB vs USD", "MBB vs Valpo", "Soccer vs Idaho"). */
const FIXTURE_TITLE = /^(vb|mbb|wbb|fb|soccer|volleyball|football|basketball|baseball|softball|wrestling|hockey|rugby|tennis|golf)\s+(vs\.?|at)\s/i;
export function isSportItem(item: ThemeInput): boolean {
  return item.vertical === 'sports' || /^(sdsu|jackrabbits?)\s/i.test(item.title) || FIXTURE_TITLE.test(item.title.trim().replace(/\s+/g, ' '))
    || (item.vertical === 'sdsu' && (item.categories ?? []).some((c) => /athletics/i.test(c)) && /\s(vs\.?|at)\s/i.test(item.title));
}

/** The week's theme. The category part is THE category function (lib/event-category.ts categorize: the source's own label, then the
 *  title, the venue last; owner 2026-11-26 (8)), so a row has the same category here as on /events/; only the themes that are not a
 *  category (library, outdoors, campus, around town) use this file's own rules, after it. */
const THEME_OF_CATEGORY: Partial<Record<Category, ThemeId>> = { civic: 'city', music: 'music', arts: 'arts', family: 'family', food: 'food', sports: 'sports' };
export function themeOf(item: ThemeInput): ThemeId {
  if (item.vertical === 'city_hall') return 'city';
  if (isSportItem(item)) return 'sports';
  const cat = categorize({ source: item.categories ?? [], title: item.title, venue: item.venue ?? null });
  const byCategory = cat ? THEME_OF_CATEGORY[cat] : undefined;
  if (byCategory) return byCategory;
  const hay = `${item.title} ${item.venue ?? ''} ${(item.categories ?? []).join(' ')}`;
  for (const rule of RULES) if (rule.re.test(hay)) return rule.id;
  return item.vertical === 'sdsu' ? 'campus' : 'community';
}

export interface WeekRow {
  /** "Fri 7pm", "Fri all day", "Fri–Sun 8am", or just "Fri" when the source has no time (a public meeting). */
  when: string;
  title: string;
  href: string | null;
  external: boolean;
  venue: string | null;
  /** When the LAST occurrence behind this row starts / ends (ISO), so the browser can hide the row once it is over.
   *  A date-only item (a meeting) starts at local midnight of its day and lasts the day. */
  start: string;
  end: string | null;
  /** When the FIRST occurrence behind this row starts (ISO): the date tile begins on this day (a row spanning Fri to Sun reads FRI-SUN). Equal to `start` for a one-day row. */
  firstStart: string;
}

export interface WeekGroup { id: ThemeId; label: string; rows: WeekRow[] }

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The clock part of a row: "7pm", "7:30pm", "all day", or "" when the source has no time. */
export function timeLabel(item: Pick<DayItem, 'startsAt' | 'endsAt'>, timezone: string): string {
  if (!item.startsAt) return '';
  const start = new Date(item.startsAt);
  if (Number.isNaN(start.getTime())) return '';
  if (isAllDay({ start: item.startsAt, end: item.endsAt }, timezone)) return 'all day';
  return formatClockCompact(start, timezone);
}

/** "Fri", "Fri–Sun" for consecutive days, "Mon, Wed, Fri" otherwise. */
export function formatDays(dayIndexes: number[]): string {
  const days = [...new Set(dayIndexes)].sort((a, b) => a - b);
  if (days.length === 1) return SHORT_DAYS[days[0]];
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return consecutive
    ? `${SHORT_DAYS[days[0]]}–${SHORT_DAYS[days[days.length - 1]]}`
    : days.map((d) => SHORT_DAYS[d]).join(', ');
}

export function formatWhen(dayIndex: number, item: Pick<DayItem, 'startsAt' | 'endsAt'>, timezone: string): string {
  const t = timeLabel(item, timezone);
  return t ? `${SHORT_DAYS[dayIndex]} ${t}` : SHORT_DAYS[dayIndex];
}

/** A short, readable venue: the parenthetical name when there is one ("Brookings, S.D. (Dana J. Dykhouse
 *  Stadium)"), else the text before the first comma; a street address keeps just its first part. */
export function shortVenue(venue: string | null | undefined, homeCity?: string): string | null {
  if (!venue) return null;
  const paren = venue.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const first = venue.split(',')[0].trim();
  // An address in another town keeps that town, so the row never reads as the home town (owner 2026-11-26: "Farm House Collective,
  // 1393 University Ave, Riverside, CA, 92507, United States" on the Moreno Valley week -> "Farm House Collective · Nearby, Riverside").
  const elsewhere = homeCity ? otherTownOf({ address: venue }, homeCity) : null;
  return first ? (elsewhere ? `${first} · Nearby, ${elsewhere}` : first) : null;
}

const SPORT_LABELS: Record<string, string> = {
  mbb: "Men's basketball", wbb: "Women's basketball", vb: 'Volleyball', fb: 'Football',
};

/** Opponent abbreviations the SDSU athletics feed uses (seen in sdsu_events 2026-10-23); expanded so a reader who
 *  does not follow college sport sees "Volleyball vs South Dakota", not "VB vs USD". Whole-word, case-sensitive. */
const OPPONENT_NAMES: Record<string, string> = {
  USD: 'South Dakota', NDSU: 'North Dakota State', UNI: 'Northern Iowa', WIU: 'Western Illinois',
};

/** "volleyball vs South Dakota" -> "Volleyball vs South Dakota"; "SDSU Football vs Murray State" -> "Football vs
 *  Murray State"; "VB vs USD" -> "Volleyball vs South Dakota"; "WBB vs  UNI" -> "Women's basketball vs Northern
 *  Iowa". Only a leading "SDSU"/"Jackrabbits" brand word is dropped, and not when the rest would start with
 *  "vs"/"at" ("SDSU vs Bradley" stays); team names like "Jacks Club" stay. */
export function normalizeSportTitle(title: string): string {
  let t = title.trim().replace(/\s+/g, ' ');
  const stripped = t.replace(/^(sdsu|jackrabbits?)\s+/i, '');
  if (!/^(vs\.?|at)(?![A-Za-z])/i.test(stripped)) t = stripped;
  const m = t.match(/^(\w+)\s+(?:vs\.?|at)\s+(.*)$/i);
  if (m) {
    const verb = /^\w+\s+at\s/i.test(t) ? 'at' : 'vs';
    const sport = SPORT_LABELS[m[1].toLowerCase()] ?? m[1];
    const opponent = m[2].replace(/(?<![A-Za-z])(USD|NDSU|UNI|WIU)(?![A-Za-z])/g, (abbr) => OPPONENT_NAMES[abbr]);
    t = `${sport} ${verb} ${opponent}`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function isQuorumNotice(title: string): boolean {
  return /possible quorum/i.test(title);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'and', 'day', 'in', 'on', 'for', 'sdsu']);
function stem(w: string): string {
  return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w;
}
function tokens(title: string): string[] {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).map(stem);
}
/** Normalized title used to recognise the same recurring item on several days. */
function titleKey(title: string): string {
  return tokens(title).join(' ');
}
/** True when every word of the shorter title appears in the other ("The Yule Market" in "Museum Shop Yule
 *  Market Opens"). Needs at least one word, and equal word sets count as inclusion. */
export function titleIncludes(a: string, b: string): boolean {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((w) => big.has(w));
}

interface FlatRow {
  dayIndex: number;
  timeLabel: string;
  startMs: number;
  item: DayItem;
  title: string;
  venue: string | null;
}

const venuesCompatible = (a: string | null, b: string | null) =>
  !a || !b || a.toLowerCase() === b.toLowerCase();
const internal = (r: FlatRow) => (r.item.href ?? '').startsWith('/s/');

/** Which of two rows describing the same thing to keep: one that links to our own page, then one with a
 *  venue, then the longer (more descriptive) title. */
function better(a: FlatRow, b: FlatRow): FlatRow {
  if (internal(a) !== internal(b)) return internal(a) ? a : b;
  if (!!a.venue !== !!b.venue) return a.venue ? a : b;
  return a.title.length >= b.title.length ? a : b;
}

function mergeSameDay(rows: FlatRow[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const row of rows) {
    const i = out.findIndex((o) => o.dayIndex === row.dayIndex && o.timeLabel === row.timeLabel
      && venuesCompatible(o.venue, row.venue) && titleIncludes(o.title, row.title));
    if (i === -1) { out.push(row); continue; }
    const keep = better(out[i], row);
    const other = keep === out[i] ? row : out[i];
    out[i] = { ...keep, venue: keep.venue ?? other.venue };
  }
  return out;
}

interface Merged { rows: FlatRow[]; days: number[] }

/** The same item on several days at the same time of day becomes one row spanning those days. */
function mergeAcrossDays(rows: FlatRow[]): Merged[] {
  const out: Merged[] = [];
  for (const row of rows) {
    const key = titleKey(row.title);
    const hit = key ? out.find((m) => titleKey(m.rows[0].title) === key && m.rows[0].timeLabel === row.timeLabel
      && venuesCompatible(m.rows[0].venue, row.venue) && !m.days.includes(row.dayIndex)) : undefined;
    if (hit) { hit.rows.push(row); hit.days.push(row.dayIndex); } else out.push({ rows: [row], days: [row.dayIndex] });
  }
  return out;
}

/** A row on several days at the same time counts as "all week" from this many days: it leaves the day blocks for the week's carousel
 *  (owner 2026-11-26 (7), principle 4: break the rhythm; a daily class is not news on each of its days). */
export const ALL_WEEK_DAYS = 3;


export interface WeekDayBlocks {
  /** Items on ALL_WEEK_DAYS or more days, one row each ("Mon–Fri 9am"): the carousel above the days. */
  allWeek: WeekRow[];
  /** One group per day that has rows, in day order: the same row data as /events/ (components/events/EventDays.astro). */
  days: DayGroupData<EventRowData>[];
}

/** The week as day blocks (owner 2026-11-26 (7), rollout a): the same cleaning as groupWeekItems (quorum notices out, sport titles,
 *  same-day duplicates merged), then items on ALL_WEEK_DAYS+ days to `allWeek`, everything else under its own day. `label` turns a
 *  day's "YYYY-MM-DD" into its heading (lib/event-row.ts labelOfDay). */
export function weekDayBlocks(
  days: DayBucket[], allDays: DayBucket[], timezone: string, label: (ymd: string) => string, homeCity?: string,
): WeekDayBlocks {
  const flat: FlatRow[] = [];
  for (const day of days) {
    const dayIndex = allDays.indexOf(day);
    for (const item of day.items) {
      if (isQuorumNotice(item.title)) continue;
      const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
      flat.push({
        dayIndex, timeLabel: timeLabel(item, timezone), startMs: Number.isFinite(start) ? start : 0, item,
        title: isSportItem(item) ? normalizeSportTitle(item.title) : item.title, venue: shortVenue(item.venue, homeCity),
      });
    }
  }
  const ymd = (i: number) => { const d = allDays[i].date; return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
  const allWeek: WeekRow[] = [];
  const byDay = new Map<number, { sort: number; row: EventRowData }[]>();
  for (const merged of mergeAcrossDays(mergeSameDay(flat))) {
    const first = merged.rows[0];
    // In another town (owner 2026-11-26 (9)): a Ticketmaster venue nearby, or an own event whose address names another town.
    const elsewhere = first.item.nearby ?? (() => { const c = homeCity ? otherTownOf({ address: first.item.venue ?? null }, homeCity) : null; return c ? { city: c, ticket: false } : undefined; })();
    // The carousel is the town's own: a nearby run stays in each day's Nearby block.
    if (merged.days.length >= ALL_WEEK_DAYS && !elsewhere) {
      const last = merged.rows[merged.rows.length - 1];
      allWeek.push({
        when: first.timeLabel ? `${formatDays(merged.days)} ${first.timeLabel}` : formatDays(merged.days),
        title: first.title, href: first.item.href, external: first.item.external, venue: first.venue,
        start: last.item.startsAt ?? localMidnightIso(allDays[last.dayIndex].date, timezone), end: last.item.endsAt ?? null,
        firstStart: first.item.startsAt ?? localMidnightIso(allDays[first.dayIndex].date, timezone),
      });
      continue;
    }
    // THE category (lib/event-category.ts), as on /events/; a city meeting is civic though its title names no body.
    const category = categorize({ source: first.item.categories ?? [], title: first.title, venue: first.venue })
      ?? (first.item.vertical === 'city_hall' ? 'civic' : null);
    for (const r of merged.rows) {
      const list = byDay.get(r.dayIndex) ?? [];
      list.push({
        sort: r.startMs,
        row: {
          start: r.item.startsAt ?? localMidnightIso(allDays[r.dayIndex].date, timezone), end: r.item.endsAt ?? null, day: ymd(r.dayIndex),
          time: r.timeLabel, title: r.title, href: r.item.href, rel: r.item.external ? 'noopener' : null,
          place: r.venue ? [r.venue] : [], extra: merged.days.length > 1 ? [formatDays(merged.days)] : [], category,
          ...(r.item.recurring ? { recurring: true } : {}),
          ...(elsewhere ? { nearby: elsewhere } : {}),
        },
      });
      byDay.set(r.dayIndex, list);
    }
  }
  return {
    allWeek,
    days: [...byDay.keys()].sort((a, b) => a - b).map((i) => ({
      key: ymd(i), label: label(ymd(i)),
      // Untimed rows (a meeting) first, as on /events/ ("all day" before the clock); then by time, then title. The town's rows, then the
      // day's rows in other towns as `nearby` (owner 2026-11-26 (9)).
      ...(() => {
        const sorted = byDay.get(i)!.sort((a, b) => a.sort - b.sort || a.row.title.localeCompare(b.row.title)).map((x) => x.row);
        return { rows: sorted.filter((r) => !r.nearby), nearby: sorted.filter((r) => r.nearby) };
      })(),
    })),
  };
}

/** Group the week's items. `days` are the days to show (past days of the current week left out); `allDays`
 *  is the full Monday-to-Sunday list, used only to find each day's weekday. `topPatterns` are the site's
 *  top-event title patterns (siteConfig.topEvents.patterns). */
export function groupWeekItems(
  days: DayBucket[], allDays: DayBucket[], timezone: string, topPatterns: string[] = [], homeCity?: string,
): WeekGroup[] {
  const flat: FlatRow[] = [];
  for (const day of days) {
    const dayIndex = allDays.indexOf(day);
    for (const item of day.items) {
      if (isQuorumNotice(item.title)) continue;
      const isSport = isSportItem(item);
      const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
      flat.push({
        dayIndex, timeLabel: timeLabel(item, timezone), startMs: Number.isFinite(start) ? start : 0, item,
        title: isSport ? normalizeSportTitle(item.title) : item.title, venue: shortVenue(item.venue, homeCity),
      });
    }
  }

  const byTheme = new Map<ThemeId, { sort: number; row: WeekRow }[]>();
  for (const merged of mergeAcrossDays(mergeSameDay(flat))) {
    const first = merged.rows[0];
    const last = merged.rows[merged.rows.length - 1];
    const lower = first.title.toLowerCase();
    const theme: ThemeId = topPatterns.some((p) => lower.includes(p.toLowerCase()))
      ? 'big' : themeOf({ ...first.item, title: first.title, venue: first.venue });
    const dayText = formatDays(merged.days);
    const row: WeekRow = {
      when: first.timeLabel ? `${dayText} ${first.timeLabel}` : dayText,
      title: first.title, href: first.item.href, external: first.item.external, venue: first.venue,
      start: last.item.startsAt ?? localMidnightIso(allDays[last.dayIndex].date, timezone),
      end: last.item.endsAt ?? null,
      firstStart: first.item.startsAt ?? localMidnightIso(allDays[first.dayIndex].date, timezone),
    };
    const list = byTheme.get(theme) ?? [];
    list.push({ sort: Math.min(...merged.days) * 1e14 + (first.startMs % 1e14), row });
    byTheme.set(theme, list);
  }

  return THEMES
    .map((t) => ({
      id: t.id, label: t.label,
      rows: (byTheme.get(t.id) ?? []).sort((a, b) => a.sort - b.sort || a.row.title.localeCompare(b.row.title)).map((x) => x.row),
    }))
    .filter((g) => g.rows.length > 0);
}
