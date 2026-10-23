/** Theme groups for the weekly page (owner restructure, 2026-10-23): under a short AI introduction the
 *  week is a DETERMINISTIC list, grouped by theme, one line per item: "Fri 7pm · Volleyball vs USD",
 *  each linked to the event page. Nothing here is written by a model, and the day and time only ever
 *  appear in these lines, never in the introduction. Empty themes are omitted.
 *
 *  Theme comes from the item's own vertical (city meetings, sports) and, for events, from its title,
 *  venue and source categories by plain keyword rules, first match wins. An item that matches no rule
 *  lands in "Around town": the grouping can only under-describe an item, never invent a fact. */
import { isAllDay } from './local-day';
import { formatClockCompact } from './country-profile';
import type { DayBucket, DayItem } from './this-week';

export type ThemeId =
  | 'city' | 'campus' | 'music' | 'arts' | 'library' | 'family' | 'outdoors' | 'food' | 'sports' | 'community';

/** Display order of the groups. */
export const THEMES: { id: ThemeId; label: string }[] = [
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

/** A short, readable venue: the parenthetical name when there is one ("Brookings, S.D. (Dana J. Dykhouse
 *  Stadium)"), else the text before the first comma; a street address keeps just its first part. */
export function shortVenue(venue: string | null | undefined): string | null {
  if (!venue) return null;
  const paren = venue.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const first = venue.split(',')[0].trim();
  return first || null;
}

/** Same item listed by two sources at the same time ("football vs Murray State" game + "SDSU Football vs
 *  Murray State" event): compared on the title without team-brand words and punctuation. */
function dedupeKey(when: string, title: string): string {
  const t = title.toLowerCase().replace(/\b(sdsu|jackrabbits?|jacks|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${when}|${t}`;
}

export interface WeekRow {
  /** "Fri 7pm", "Fri all day", or just "Fri" when the source has no time (a public meeting). */
  when: string;
  title: string;
  href: string | null;
  external: boolean;
  venue: string | null;
}

export interface WeekGroup { id: ThemeId; label: string; rows: WeekRow[] }

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatWhen(dayIndex: number, item: Pick<DayItem, 'startsAt' | 'endsAt'>, timezone: string): string {
  const day = SHORT_DAYS[dayIndex];
  if (!item.startsAt) return day;
  const start = new Date(item.startsAt);
  if (Number.isNaN(start.getTime())) return day;
  if (isAllDay({ start: item.startsAt, end: item.endsAt }, timezone)) return `${day} all day`;
  return `${day} ${formatClockCompact(start, timezone)}`;
}

/** Group the week's items by theme. `days` are the days to show (past days of the current week left
 *  out); `allDays` is the full Monday-to-Sunday list, used only to find each day's weekday. */
export function groupWeekItems(days: DayBucket[], allDays: DayBucket[], timezone: string): WeekGroup[] {
  const byTheme = new Map<ThemeId, { sort: number; row: WeekRow }[]>();
  for (const day of days) {
    const dayIndex = allDays.indexOf(day);
    for (const item of day.items) {
      const theme = themeOf(item);
      const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
      const row: WeekRow = {
        when: formatWhen(dayIndex, item, timezone),
        title: item.title, href: item.href, external: item.external, venue: shortVenue(item.venue),
      };
      const list = byTheme.get(theme) ?? [];
      const key = dedupeKey(row.when, row.title);
      const dup = list.find((x) => dedupeKey(x.row.when, x.row.title) === key);
      if (dup) {
        // keep the row that links to one of our own pages, and the one with a venue
        if (!dup.row.href?.startsWith('/s/') && row.href?.startsWith('/s/')) dup.row = row;
        else if (!dup.row.venue && row.venue) dup.row.venue = row.venue;
        continue;
      }
      list.push({ sort: dayIndex * 1e14 + (Number.isFinite(start) ? start % 1e14 : 0), row });
      byTheme.set(theme, list);
    }
  }
  return THEMES
    .map((t) => ({
      id: t.id, label: t.label,
      rows: (byTheme.get(t.id) ?? []).sort((a, b) => a.sort - b.sort || a.row.title.localeCompare(b.row.title)).map((x) => x.row),
    }))
    .filter((g) => g.rows.length > 0);
}
