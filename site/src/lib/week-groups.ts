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
import { isAllDay } from './local-day';
import { formatClockCompact } from './country-profile';
import type { DayBucket, DayItem } from './this-week';

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

export function themeOf(item: ThemeInput): ThemeId {
  if (item.vertical === 'city_hall') return 'city';
  if (item.vertical === 'sports') return 'sports';
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
export function shortVenue(venue: string | null | undefined): string | null {
  if (!venue) return null;
  const paren = venue.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const first = venue.split(',')[0].trim();
  return first || null;
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

/** Group the week's items. `days` are the days to show (past days of the current week left out); `allDays`
 *  is the full Monday-to-Sunday list, used only to find each day's weekday. `topPatterns` are the site's
 *  top-event title patterns (siteConfig.topEvents.patterns). */
export function groupWeekItems(
  days: DayBucket[], allDays: DayBucket[], timezone: string, topPatterns: string[] = [],
): WeekGroup[] {
  const flat: FlatRow[] = [];
  for (const day of days) {
    const dayIndex = allDays.indexOf(day);
    for (const item of day.items) {
      if (isQuorumNotice(item.title)) continue;
      const isSport = item.vertical === 'sports' || /^(sdsu|jackrabbits?)\s/i.test(item.title);
      const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
      flat.push({
        dayIndex, timeLabel: timeLabel(item, timezone), startMs: Number.isFinite(start) ? start : 0, item,
        title: isSport ? normalizeSportTitle(item.title) : item.title, venue: shortVenue(item.venue),
      });
    }
  }

  const byTheme = new Map<ThemeId, { sort: number; row: WeekRow }[]>();
  for (const merged of mergeAcrossDays(mergeSameDay(flat))) {
    const first = merged.rows[0];
    const lower = first.title.toLowerCase();
    const theme: ThemeId = topPatterns.some((p) => lower.includes(p.toLowerCase()))
      ? 'big' : themeOf({ ...first.item, title: first.title, venue: first.venue });
    const dayText = formatDays(merged.days);
    const row: WeekRow = {
      when: first.timeLabel ? `${dayText} ${first.timeLabel}` : dayText,
      title: first.title, href: first.item.href, external: first.item.external, venue: first.venue,
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
