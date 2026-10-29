/** Threshold engine for the evening layer (/tonight, /this-weekend): decides per town
 *  whether the layer has enough to be indexable. Owner decisions 2026-10-28
 *  (.claude/specs/weekend-layer.md, "Skydd mot low value content"):
 *
 *   - Measure: the MEDIAN over the next 14 evenings of (a) items and (b) distinct
 *     groups on that evening. A single big night (a stadium show) cannot carry a town.
 *   - Enter at a median of >= 6 items and >= 3 groups; once indexable, stay until the median falls
 *     below 5 items or 3 groups (hysteresis, so a town does not flap in and out of the
 *     sitemap on a quiet week).
 *   - Config-driven: a town whose `eveningLayer.mode` is 'never' stays noindex whatever
 *     the data says (Brookings).
 *
 *  Pure function of (items, now, timezone, previous verdict): no I/O, no globals. The
 *  caller supplies `previouslyIndexable` (step 7 persists it); without it the engine
 *  applies the stricter entry bar. An evening is the part of a local day that starts at
 *  TONIGHT_FROM_HOUR (17:00) -- the same cut-off /today's Tonight bucket uses. */
import { TONIGHT_FROM_HOUR, localDayNumber, localHourOf } from './local-day';

export const EVENING_NIGHTS = 14;
/** Owner 2026-10-29 (was 10 in / 8 out): median 6 items per evening in, below 5 out. */
export const EVENING_ENTER_ITEMS = 6;
export const EVENING_EXIT_ITEMS = 5;
/** Owner 2026-10-29: "Open late" counts as ONE group on an evening with at least this many places open late. Never as items. */
export const EVENING_OPEN_LATE_MIN_PLACES = 3;
export const EVENING_MIN_GROUPS = 3;
/** From this local hour "tonight" is as good as over and the window starts tomorrow. */
export const EVENING_LAST_START_HOUR = 23;

export type EveningLayerMode = 'threshold' | 'never';

export interface EveningItem {
  /** ISO instant the item starts. */
  start: string;
  /** Group label (Live music, Comedy & shows, ...). Items without one count toward no group. */
  group: string | null;
}

export interface EveningNight {
  /** Local calendar day number (days since epoch), see localDayNumber(). */
  day: number;
  items: number;
  groups: number;
}

export interface EveningVerdict {
  indexable: boolean;
  reason: 'config' | 'enter' | 'stay' | 'below-items' | 'below-groups';
  medianItems: number;
  medianGroups: number;
  nights: EveningNight[];
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Items and distinct groups per evening for the next `nights` evenings. */
export function eveningNights(items: EveningItem[], now: Date, timezone: string, nights = EVENING_NIGHTS, openLateByDay: Record<number, number> = {}): EveningNight[] {
  const first = localDayNumber(now, timezone) + (localHourOf(now, timezone) >= EVENING_LAST_START_HOUR ? 1 : 0);
  const byDay = new Map<number, { items: number; groups: Set<string> }>();
  for (const it of items) {
    const at = new Date(it.start);
    if (Number.isNaN(at.getTime()) || localHourOf(at, timezone) < TONIGHT_FROM_HOUR) continue;
    const day = localDayNumber(at, timezone);
    if (day < first || day >= first + nights) continue;
    const slot = byDay.get(day) ?? { items: 0, groups: new Set<string>() };
    slot.items += 1;
    if (it.group) slot.groups.add(it.group);
    byDay.set(day, slot);
  }
  return Array.from({ length: nights }, (_, i) => {
    const slot = byDay.get(first + i);
    const lateGroup = (openLateByDay[first + i] ?? 0) >= EVENING_OPEN_LATE_MIN_PLACES ? 1 : 0;
    return { day: first + i, items: slot?.items ?? 0, groups: (slot?.groups.size ?? 0) + lateGroup };
  });
}

export function evaluateEveningThreshold(opts: {
  items: EveningItem[];
  now: Date;
  timezone: string;
  mode?: EveningLayerMode;
  previouslyIndexable?: boolean;
  /** Places open late per local day number (days since epoch); >= EVENING_OPEN_LATE_MIN_PLACES adds one group, never an item. */
  openLateByDay?: Record<number, number>;
}): EveningVerdict {
  const nights = eveningNights(opts.items, opts.now, opts.timezone, EVENING_NIGHTS, opts.openLateByDay);
  const medianItems = median(nights.map((n) => n.items));
  const medianGroups = median(nights.map((n) => n.groups));
  const base = { medianItems, medianGroups, nights };
  if ((opts.mode ?? 'threshold') === 'never') return { ...base, indexable: false, reason: 'config' };
  const was = opts.previouslyIndexable === true;
  const itemsBar = was ? EVENING_EXIT_ITEMS : EVENING_ENTER_ITEMS;
  if (medianItems < itemsBar) return { ...base, indexable: false, reason: 'below-items' };
  if (medianGroups < EVENING_MIN_GROUPS) return { ...base, indexable: false, reason: 'below-groups' };
  return { ...base, indexable: true, reason: was ? 'stay' : 'enter' };
}
