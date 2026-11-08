/** Part of the 15-minute tick: raise an error for an ACTIVE sports source whose sport_sources_health has no successful run in the last 36 hours
 *  (no row at all counts as never). Same channel as the other failures here: the invocation fails and Cloudflare's logs carry the message.
 *  The runner (sports/runner.py) writes the rows; a source that was switched off is simply not listed in SPORT_SOURCES. */
import type { Sql } from '../alerts/store';

export interface SportSource { townId: string; sourceId: string }

/** Mirrors configs/<town>.json: every town with sports.enabled, and `${adapter}:${program}` for each of its sports.sources
 *  (test/sports-health.test.ts fails when they drift apart). */
export const SPORT_SOURCES: SportSource[] = [
  { townId: 'brookings_sd', sourceId: 'internal:sdsu' },
  { townId: 'brookings_sd', sourceId: 'internal:sdsu-club-hockey' },
];

export const STALE_HOURS = 36;

export interface SportHealthResult { townId: string; ok: boolean; error?: string }

export async function checkSportHealth(deps: { sql: Sql; now?: Date; sources?: SportSource[] }): Promise<SportHealthResult[]> {
  const now = deps.now ?? new Date();
  const sources = deps.sources ?? SPORT_SOURCES;
  if (sources.length === 0) return [];
  const rows = (await deps.sql`SELECT town_id, source_id, last_success FROM sport_sources_health`) as { town_id: string; source_id: string; last_success: string | Date | null }[];
  const cutoff = now.getTime() - STALE_HOURS * 3600_000;
  return sources.map((s) => {
    const row = rows.find((r) => r.town_id === s.townId && r.source_id === s.sourceId);
    const last = row?.last_success ? new Date(row.last_success).getTime() : null;
    if (last !== null && last >= cutoff) return { townId: s.townId, ok: true };
    const since = last === null ? 'has never succeeded' : `last succeeded ${new Date(last).toISOString()}`;
    return { townId: s.townId, ok: false, error: `sports source ${s.sourceId} ${since} (more than ${STALE_HOURS} h)` };
  });
}
