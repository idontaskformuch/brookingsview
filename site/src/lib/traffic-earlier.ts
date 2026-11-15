/** /traffic/ "Earlier this week" (owner 2026-11-15): incidents from traffic_incidents that started within the last
 *  TRAFFIC_EARLIER_DAYS days and are no longer active, newest first, each with its day and time, place, type and the source link.
 *  Nothing is made up and no explanation text is shown; with no such incidents the group is not shown at all.
 *
 *  "No longer active" = not listed by the latest read (last seen before that read started) or cleared by the source (ends_at in the past).
 *  An incident the latest read still lists is never in this group, even when that read is older than TRAFFIC_READ_MAX_AGE_HOURS and the
 *  current list is empty: the site does not know it has ended. "Started" = the source's own start time, or when a read first saw it.
 *  An incident counts only when the page's own classification keeps it (in town or on a corridor in range), same as the current list. */
import { classifyTrafficIncident, type TrafficClassification } from './traffic';
import type { TrafficIncident } from './db';

export const TRAFFIC_EARLIER_DAYS = 7;

export type EarlierTrafficIncident = TrafficIncident & TrafficClassification & { at: string };

export function earlierTrafficIncidents(
  rows: TrafficIncident[],
  o: { latestReadStart: string | null; now: Date; townId: string; corridors: { label: string; numbers: string[] }[] | undefined; corridorMaxMiles: number | undefined },
): EarlierTrafficIncident[] {
  // The driver may hand back Date objects for timestamptz columns; new Date() reads both.
  const ms = (v: string | Date) => new Date(v).getTime();
  const now = o.now.getTime();
  const since = now - TRAFFIC_EARLIER_DAYS * 86_400_000;
  const readStart = o.latestReadStart ? ms(o.latestReadStart) : null;
  const out: EarlierTrafficIncident[] = [];
  for (const r of rows) {
    const at = r.starts_at ?? r.created_at;
    if (!at) continue;
    const t = ms(at);
    if (Number.isNaN(t) || t < since || t > now) continue;
    const ended = r.ends_at != null && ms(r.ends_at) < now;
    const inLatestRead = readStart != null && ms(r.last_seen_at) >= readStart;
    if (inLatestRead && !ended) continue;
    const c = classifyTrafficIncident(r, o.townId, o.corridors, o.corridorMaxMiles);
    if (c) out.push({ ...r, ...c, at: new Date(at).toISOString() });
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at));
}
