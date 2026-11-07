/** /this-weekend (step 4, spec .claude/specs/weekend-layer.md T3): Friday evening to Sunday night from the same EveningEntry rows and
 *  components as /tonight. Pure functions. Groups follow the spec (Nights out & live music, Sport, Markets & food, Family, Free) and are
 *  derived from the entry's own group, so no source is classified twice. Saturday and Sunday run all day, Friday from 17:00. */
import type { EveningEntry } from './evening-items';
import { localDayNumber, localHourOf, TONIGHT_FROM_HOUR } from './local-day';
import { pickHighlights, isNearEntry, type EveningListGroup } from './evening-page';

export type WeekendKind = 'friday' | 'saturday' | 'sunday';
export const WEEKEND_GROUP_ORDER = ['Nights out & live music', 'Sport', 'Markets & food', 'Family', 'Free', 'Also on'] as const;
/** Rows shown per group and day; the rest are counted and pointed to the full lists. */
export const WEEKEND_ROWS_PER_GROUP = 8;

export function weekendGroupOf(e: EveningEntry): string {
  switch (e.group) {
    case 'Sport': return 'Sport';
    case 'Festivals & fairs': return 'Markets & food';
    case 'Family': return 'Family';
    case 'Live music': case 'Comedy & shows': case 'Theatre': case 'Quiz & pub nights': case 'Clubs & late': case 'Film': return 'Nights out & live music';
    default: return e.labels.includes('Free') ? 'Free' : 'Also on';
  }
}

/** ISO weekday of a local day number (1 = Monday). 1970-01-01 was a Thursday. */
const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1;

/** Friday of the weekend a visitor wants: this week's Friday from Friday on (Saturday and Sunday still show the running weekend),
 *  otherwise the coming one. */
export function weekendFriday(now: Date, tz: string): number {
  const today = localDayNumber(now, tz);
  const wd = isoWeekday(today);
  return wd >= 5 ? today - (wd - 5) : today + (5 - wd);
}

export interface WeekendSection {
  day: number;
  kind: WeekendKind;
  highlights: EveningEntry[];
  groups: Array<EveningListGroup & { more: number }>;
  /** Rows beyond nearMiles, under "Nearby this weekend" (same per-group cap). */
  farGroups: Array<EveningListGroup & { more: number }>;
  count: number;
  /** Rows within nearMiles (in the town): the number an "in {Town}" heading may use. */
  nearCount: number;
}

export function buildWeekendSections(entries: EveningEntry[], now: Date, tz: string, perGroup = WEEKEND_ROWS_PER_GROUP, nearMiles?: number): WeekendSection[] {
  const friday = weekendFriday(now, tz);
  const kinds: WeekendKind[] = ['friday', 'saturday', 'sunday'];
  return kinds.map((kind, i) => {
    const day = friday + i;
    const from = kind === 'friday' ? TONIGHT_FROM_HOUR : 0;
    const dayEntries = entries.filter((e) => {
      const at = new Date(e.start);
      return localDayNumber(at, tz) === day && localHourOf(at, tz) >= from;
    });
    const near = dayEntries.filter((e) => isNearEntry(e, nearMiles));
    // With a near/far split the highlights are in-town rows only: a regional show never headlines an "in {Town}" page.
    const highlights = pickHighlights(nearMiles != null ? near : dayEntries);
    const groupsOf = (list: EveningEntry[]) => {
      const byName = new Map<string, EveningEntry[]>();
      for (const e of list) byName.set(weekendGroupOf(e), [...(byName.get(weekendGroupOf(e)) ?? []), e]);
      return WEEKEND_GROUP_ORDER.filter((n) => byName.has(n)).map((name) => {
        const all = byName.get(name)!.sort((a, b) => a.start.localeCompare(b.start));
        return { name, entries: all.slice(0, perGroup), more: Math.max(0, all.length - perGroup) };
      });
    };
    const rest = dayEntries.filter((e) => !highlights.includes(e));
    return { day, kind, highlights, groups: groupsOf(rest.filter((e) => isNearEntry(e, nearMiles))), farGroups: groupsOf(rest.filter((e) => !isNearEntry(e, nearMiles))), count: dayEntries.length, nearCount: near.length };
  });
}

/** A day that is over is hidden by the browser (the build can be a day old). */
export function weekendDayHidden(day: number, now: Date, tz: string): boolean {
  return day < localDayNumber(now, tz);
}
