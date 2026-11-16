/** /traffic/: what the page knows about its latest read (audit Fas 6a, owner 2026-11-16).
 *
 *  One row of scrape_runs (db.ts getTrafficLatestRead) gives every time on the page: started_at cuts the list (incidents last seen at
 *  or after it) and decides "out of date" (older than TRAFFIC_READ_MAX_AGE_HOURS); finished_at is the clock shown. A run that has not
 *  finished, or did not end 'ok', is never a read: the page then has no data, the same as a town whose feed was never read.
 *
 *  Out of date: no hero and no current list. The page says "Not updated since <clock>. For conditions now, see <source>." and, while
 *  the read is at most TRAFFIC_LAST_LISTED_MAX_DAYS old, lists the closures that read last listed under "Last listed <clock>"
 *  (closures and planned closures only: a crash from days ago says nothing about now). Never read: "No data yet. For conditions now,
 *  see <source>." */
import type { TrafficIncident, TrafficReadRun } from './db';
import { TRAFFIC_READ_MAX_AGE_HOURS } from './traffic-verdict';
import { trafficReadClock } from './traffic-hero';

export const TRAFFIC_LAST_LISTED_MAX_DAYS = 7;

export type TrafficReadState =
  | { kind: 'none' }
  | { kind: 'fresh'; start: string; finish: string }
  | { kind: 'stale'; start: string; finish: string; showLastListed: boolean };

const iso = (v: string | Date) => new Date(v).toISOString();

export function trafficReadState(run: TrafficReadRun | null, now: Date): TrafficReadState {
  if (!run || run.status !== 'ok' || run.finished_at == null || run.started_at == null) return { kind: 'none' };
  const start = iso(run.started_at);
  const finish = iso(run.finished_at);
  const ageMs = now.getTime() - Date.parse(start);
  if (ageMs <= TRAFFIC_READ_MAX_AGE_HOURS * 3_600_000) return { kind: 'fresh', start, finish };
  return { kind: 'stale', start, finish, showLastListed: ageMs <= TRAFFIC_LAST_LISTED_MAX_DAYS * 86_400_000 };
}

/** The first sentence of the out-of-date line; the page adds "For conditions now, see <source link>." null for a fresh read. */
export function trafficStaleLead(state: TrafficReadState, now: Date, tz: string, locale: string): string | null {
  if (state.kind === 'none') return 'No data yet.';
  if (state.kind === 'stale') return `Not updated since ${trafficReadClock(state.finish, now, tz, locale)}.`;
  return null;
}

/** "Last listed" keeps closures and planned closures only. */
export function lastListedRows<T extends Pick<TrafficIncident, 'severity'>>(rows: T[]): T[] {
  return rows.filter((r) => r.severity === 'closure' || r.severity === 'planned');
}
