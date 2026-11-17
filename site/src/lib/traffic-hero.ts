/** /traffic/ top block (audit Fas 6a, owner 2026-11-16): the hero and its insight lines, built only from traffic_incidents fields.
 *  Every line has a rule and a threshold (exported) and is left out when its rule does not fire.
 *
 *  Duplicates (display only, the DB is untouched): rows with the same title, road (the road string carries the direction), start and
 *  position are one incident, shown once with the latest ends_at. A row without a start or a position is never merged: Caltrans gives
 *  no start, and two different closures on the same stretch (K-rail installation / slide removal) share title, road and position.
 *
 *  Read time: scrape_runs.finished_at of the latest finished successful traffic read (getTrafficLatestRead, lib/traffic-read.ts),
 *  floored to the minute. */
import type { TrafficIncident } from './db';
import { extractRouteNumber, trafficKind } from './traffic';

/** "Most affected road" needs at least this many rows on one road, and strictly more than any other road. */
export const ROAD_MIN_ROWS = 2;
/** "Listed until" only for a closure whose source end is at least this far ahead. */
export const LISTED_UNTIL_MIN_HOURS = 48;

type Row = Pick<TrafficIncident, 'title' | 'road' | 'lat' | 'lon' | 'ends_at'> & { starts_at?: string | null };
const ms = (v: string | Date) => new Date(v).getTime();

/** null = the row is never merged with another. */
export function trafficDedupeKey(r: Row): string | null {
  if (r.starts_at == null || r.lat == null || r.lon == null) return null;
  return [r.title, r.road ?? '', ms(r.starts_at), r.lat, r.lon].join('|');
}

/** First row of each duplicate group, in input order, carrying the group's latest ends_at (a known end beats none). */
export function dedupeTrafficIncidents<T extends Row>(rows: T[]): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const k = trafficDedupeKey(r);
    const i = k == null ? undefined : at.get(k);
    if (i === undefined) {
      if (k != null) at.set(k, out.length);
      out.push(r);
      continue;
    }
    const kept = out[i];
    if (r.ends_at != null && (kept.ends_at == null || ms(r.ends_at) > ms(kept.ends_at))) out[i] = { ...kept, ends_at: r.ends_at };
  }
  return out;
}

/** Earlier rows that are the same incident as a current row are dropped (the current list already shows it). */
export function withoutCurrent<T extends Row>(earlier: T[], current: Row[]): T[] {
  const keys = new Set(current.map(trafficDedupeKey).filter((k): k is string => k != null));
  return earlier.filter((r) => { const k = trafficDedupeKey(r); return k == null || !keys.has(k); });
}

/** Capitalised plain words ("Installation") become lower case; "K-rail", "AC" and numbers stay as the source wrote them. */
const lowerWords = (s: string) => s.split(' ').map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(' ');

/** The cause from the source's structured "... Due to <cause> / ..." field (Caltrans lane closures), lower case for use mid-sentence:
 *  "K-rail installation", "slide removal". null when the description has no such field. */
export function trafficCause(description: string | null | undefined): string | null {
  const m = description ? / Due to ([^/]+?) \//.exec(description) : null;
  return m ? lowerWords(m[1].trim()) : null;
}
export const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "3:25 AM PST" for a read on the same local day as `now`, "Sun 11:02 PM MST" within the past six days, "Nov 5, 3:25 AM PST" from
 *  seven days back (a weekday alone would point at this week). Seconds are dropped (floor). */
export function trafficReadClock(readAt: string | Date, now: Date, tz: string, locale: string): string {
  const d = new Date(Math.floor(ms(readAt) / 60_000) * 60_000);
  const day = (x: Date) => Date.parse(`${x.toLocaleDateString('en-CA', { timeZone: tz })}T00:00:00Z`);
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const clock = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
  if (days === 0) return clock;
  if (days < 7) return `${d.toLocaleDateString(locale, { weekday: 'short', timeZone: tz })} ${clock}`;
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: tz })}, ${clock}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export interface TrafficHero { value: string; sub: string; meta: string }

/** null when the read is missing or too old (nothing is known about now) or when the page shows no rows at all. */
export function trafficHero(o: {
  current: Pick<TrafficIncident, 'incident_type' | 'title'>[]; earlierCount: number; readAt: string | null; readIsStale: boolean;
  now: Date; tz: string; locale: string; scope: string; cityName: string;
}): TrafficHero | null {
  if (!o.readAt || o.readIsStale) return null;
  if (o.current.length === 0 && o.earlierCount === 0) return null;
  const where = `on ${o.scope} in and near ${o.cityName}`;
  const asOf = `As of ${trafficReadClock(o.readAt, o.now, o.tz, o.locale)}`;
  if (o.current.length === 0) return { value: 'None listed', sub: where, meta: `${asOf} · ${o.earlierCount} earlier this week` };
  const closures = o.current.filter((r) => trafficKind(r) === 'closure').length;
  const incidents = o.current.length - closures;
  const kinds = [closures ? plural(closures, 'closure') : '', incidents ? plural(incidents, 'incident') : ''].filter(Boolean).join(', ');
  return { value: String(o.current.length), sub: `${kinds} ${where}`, meta: asOf };
}

/** "Most affected road: SR-60, 3 of 7 listed". Counts the page's rows (current + earlier) per configured corridor, both directions
 *  together; rows without a road, or on a road that is not a corridor, count only in the total. */
export function mostAffectedRoad(rows: Pick<TrafficIncident, 'road'>[], corridors: { label: string; numbers: string[] }[] | undefined): string | null {
  const per = new Map<string, number>();
  for (const r of rows) {
    const n = extractRouteNumber(r.road);
    const c = n ? corridors?.find((x) => x.numbers.includes(n)) : undefined;
    if (c) per.set(c.label, (per.get(c.label) ?? 0) + 1);
  }
  const [top, second] = [...per.entries()].sort((a, b) => b[1] - a[1]);
  if (!top || top[1] < ROAD_MIN_ROWS || (second && second[1] === top[1])) return null;
  return `Most affected road: ${top[0]}, ${top[1]} of ${rows.length} listed`;
}

/** "Westbound 60 slide removal listed until Wed, Dec 30": the current row whose source end is furthest ahead, when that is at least
 *  LISTED_UNTIL_MIN_HOURS away. Without a cause the title stands in ("Westbound 60 lane closure"). */
export function listedUntil(current: Pick<TrafficIncident, 'title' | 'road' | 'description' | 'ends_at'>[], now: Date, tz: string, locale: string): string | null {
  const far = current
    .filter((r) => r.ends_at != null && ms(r.ends_at) - now.getTime() >= LISTED_UNTIL_MIN_HOURS * 3_600_000)
    .sort((a, b) => ms(b.ends_at!) - ms(a.ends_at!))[0];
  if (!far) return null;
  const cause = trafficCause(far.description);
  const [first, ...rest] = far.title.split(' ');
  const subject = far.road && cause ? `${far.road} ${cause}` : [first, lowerWords(rest.join(' '))].filter(Boolean).join(' ');
  const end = new Date(far.ends_at!);
  const sameYear = end.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 4) === now.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 4);
  const date = end.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: tz });
  return `${subject} listed until ${date}`;
}
