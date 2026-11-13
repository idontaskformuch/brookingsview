/** Layout of /tonight: which evenings, which highlights, which groups. Pure functions over EveningEntry rows (lib/evening-items.ts).
 *  Server-rendered for the build's "tonight" and "tomorrow night"; the browser then hides what has ended and flips the headings
 *  with sectionState() (the build can be hours old). Spec: .claude/specs/weekend-layer.md T2. */
import type { EveningEntry, EveningGroup } from './evening-items';
import { localDayNumber, localHourOf, TONIGHT_FROM_HOUR, HAPPY_HOUR_FROM_HOUR, HAPPY_HOUR_RE } from './local-day';
import { EVENING_LAST_START_HOUR } from './evening-threshold';

export const GROUP_ORDER: EveningGroup[] = ['Live music', 'Comedy & shows', 'Theatre', 'Quiz & pub nights', 'Clubs & late', 'Sport', 'Family', 'Festivals & fairs', 'Film'];
export const FREE_GROUP = 'Free tonight';
export const OTHER_GROUP = 'Also on';
export const MAX_HIGHLIGHTS = 3;

export interface EveningListGroup { name: string; entries: EveningEntry[] }
/** Near / far split (siteConfig.eveningLayer.nearMiles): a row with no distance (own events, register rows without one) counts as near. */
export const isNearEntry = (e: EveningEntry, nearMiles: number | undefined) => nearMiles == null || e.distanceMiles == null || e.distanceMiles <= nearMiles;

export interface EveningSection {
  /** Local calendar day number of the evening. */
  day: number;
  kind: 'tonight' | 'tomorrow';
  highlights: EveningEntry[];
  groups: EveningListGroup[];
  /** Groups of the rows beyond nearMiles, shown under "Nearby tonight"; empty when no split is configured. */
  farGroups: EveningListGroup[];
  count: number;
  /** Rows within nearMiles (in the town): the number an "in {Town}" heading may use. count - nearCount are the nearby/regional rows. */
  nearCount: number;
}

const byStart = (a: EveningEntry, b: EveningEntry) => a.start.localeCompare(b.start);

/** Up to MAX_HIGHLIGHTS entries: the earliest of each distinct group first, then the earliest of the rest. */
export function pickHighlights(entries: EveningEntry[], max = MAX_HIGHLIGHTS): EveningEntry[] {
  const sorted = [...entries].sort(byStart);
  const out: EveningEntry[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    if (!e.group || seen.has(e.group)) continue;
    seen.add(e.group);
    out.push(e);
    if (out.length === max) return out.sort(byStart);
  }
  for (const e of sorted) {
    if (out.length === max) break;
    if (!out.includes(e)) out.push(e);
  }
  return out.sort(byStart);
}

/** Compact rows by group: the five groups in order, then "Free tonight" (free, no group of its own), then "Also on". Empty groups are left out. */
export function groupEntries(entries: EveningEntry[]): EveningListGroup[] {
  const byName = new Map<string, EveningEntry[]>();
  for (const e of entries) {
    const name = e.group ?? (e.labels.includes('Free') ? FREE_GROUP : OTHER_GROUP);
    byName.set(name, [...(byName.get(name) ?? []), e]);
  }
  return [...GROUP_ORDER, FREE_GROUP, OTHER_GROUP]
    .filter((n) => byName.has(n))
    .map((name) => ({ name, entries: byName.get(name)!.sort(byStart) }));
}

/** The evening of `day`: entries starting at/after 17:00 local that day, a happy hour from 15:00 (owner 2026-11-13). Highlights come
 *  out of the compact rows (no row twice). */
export function eveningEntries(entries: EveningEntry[], day: number, tz: string): EveningEntry[] {
  return entries.filter((e) => {
    const at = new Date(e.start);
    return localDayNumber(at, tz) === day && localHourOf(at, tz) >= (HAPPY_HOUR_RE.test(e.title) ? HAPPY_HOUR_FROM_HOUR : TONIGHT_FROM_HOUR);
  });
}

export function buildSection(entries: EveningEntry[], day: number, kind: 'tonight' | 'tomorrow', tz: string, withHighlights: boolean, nearMiles?: number): EveningSection {
  const evening = eveningEntries(entries, day, tz);
  const near = evening.filter((e) => isNearEntry(e, nearMiles));
  const far = evening.filter((e) => !isNearEntry(e, nearMiles));
  // With a near/far split the highlights are in-town rows only: a regional show never headlines an "in {Town}" page.
  const highlights = withHighlights ? pickHighlights(nearMiles != null ? near : evening) : [];
  return {
    day, kind, highlights, groups: groupEntries(near.filter((e) => !highlights.includes(e))),
    farGroups: groupEntries(far.filter((e) => !highlights.includes(e))), count: evening.length, nearCount: near.length,
  };
}

export function buildEveningSections(entries: EveningEntry[], now: Date, tz: string, nearMiles?: number): EveningSection[] {
  const today = localDayNumber(now, tz);
  return [buildSection(entries, today, 'tonight', tz, true, nearMiles), buildSection(entries, today + 1, 'tomorrow', tz, false, nearMiles)];
}

export interface SectionState { hidden: boolean; kind: 'tonight' | 'tomorrow' }

/** What the browser shows for a section built for local day `day`. After 23:00 "tonight" is over and is hidden; a section built for
 *  yesterday is hidden; one built for tomorrow reads "Tomorrow night" until midnight, then "Tonight". */
export function sectionState(day: number, now: Date, tz: string): SectionState {
  const today = localDayNumber(now, tz);
  if (day < today) return { hidden: true, kind: 'tonight' };
  if (day === today) return { hidden: localHourOf(now, tz) >= EVENING_LAST_START_HOUR, kind: 'tonight' };
  return { hidden: day > today + 1, kind: 'tomorrow' };
}
