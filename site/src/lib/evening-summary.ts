/** The one-line summary at the top of /tonight and /this-weekend, computed from the page's own data (no generated text, owner 2026-10-29):
 *  how many things are on, how many places stay open after 1 am, and (Glasgow) the last Subway train. A part with no data is left out. */
import type { GettingHome } from './getting-home';
import type { OpenLateRow } from './osm-open-late';
import { localInstantIso } from './local-day';

export interface SummaryPart { key: 'count' | 'late' | 'train'; text: string }

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

/** Open-late rows that close after 01:00 the next morning (local) on the evening of calendar day `day` (days since epoch). */
export function openAfterOneCount(rows: OpenLateRow[], day: number, tz: string): number {
  const d = new Date((day + 1) * 86_400_000);
  const cutoff = new Date(localInstantIso({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }, 1, 0, tz)).getTime();
  return rows.filter((r) => new Date(r.end).getTime() > cutoff).length;
}

/** Latest last-train time across the Subway circles for the evening's weekday ('monSat' or 'sunday'), e.g. "23:30". */
export function lastSubwayTime(home: GettingHome | null, sunday: boolean): string | null {
  if (!home) return null;
  const times = home.subway.lastTrains.map((t) => (sunday ? t.sunday : t.monSat)).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  return times.length ? times[times.length - 1] : null;
}

export function buildSummary(o: { count: number; period: string; openAfterOne: number; lastTrain: string | null; subwayName?: string }): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (o.count > 0) parts.push({ key: 'count', text: `${plural(o.count, 'thing', 'things')} on ${o.period}` });
  if (o.openAfterOne > 0) parts.push({ key: 'late', text: `${plural(o.openAfterOne, 'place', 'places')} open after 1 am` });
  if (o.lastTrain) parts.push({ key: 'train', text: `Last ${o.subwayName ?? 'Subway'} train ${o.lastTrain}` });
  return parts;
}
