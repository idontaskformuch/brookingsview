/** Heartbeat per town and job in dispatcher_heartbeat (migration 069): last_ok moves only on a successful fetch, a failure records
 *  last_error / last_error_at and leaves last_ok alone. scripts/check_freshness.py (GitHub's own schedule) reads it and opens an issue when
 *  last_ok is older than 2 h ('alerts') or 3 h ('safety'). The `events` table cannot show this: warnings are written only when they change.
 *
 *  A heartbeat write must NEVER stop or fail the job it describes: every function here catches its own errors and only logs them. */
import type { Sql } from './alerts/store';
import type { SafetyResult } from './safety/refresh';

/** The job names scripts/check_freshness.py reads (tests/test_freshness.py fails when they drift apart). */
export const HEARTBEAT_JOBS = ['alerts', 'safety'] as const;
export type HeartbeatJob = (typeof HEARTBEAT_JOBS)[number];

export interface HeartbeatInput { townId: string; ok: boolean; error?: string }

export async function recordHeartbeat(sql: Sql, job: HeartbeatJob, r: HeartbeatInput): Promise<void> {
  try {
    if (r.ok) {
      await sql`
        INSERT INTO dispatcher_heartbeat (town_id, job, last_ok) VALUES (${r.townId}, ${job}, now())
        ON CONFLICT (town_id, job) DO UPDATE SET last_ok = now()`;
    } else {
      await sql`
        INSERT INTO dispatcher_heartbeat (town_id, job, last_error, last_error_at) VALUES (${r.townId}, ${job}, ${(r.error ?? 'unknown error').slice(0, 500)}, now())
        ON CONFLICT (town_id, job) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = now()`;
    }
  } catch (e) {
    console.error(`heartbeat ${job}/${r.townId} not recorded: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
}

export async function recordHeartbeats(sql: Sql, job: HeartbeatJob, results: HeartbeatInput[]): Promise<void> {
  for (const r of results) await recordHeartbeat(sql, job, r);
}

/** A safety town is healthy when none of its parts (fire, air) failed; an air part skipped for a missing key counts as fine. */
export function safetyTownResults(results: SafetyResult[]): HeartbeatInput[] {
  const byTown = new Map<string, HeartbeatInput>();
  for (const r of results) {
    const cur = byTown.get(r.townId) ?? { townId: r.townId, ok: true };
    if (!r.ok) {
      cur.ok = false;
      cur.error = [cur.error, `${r.part}: ${r.error ?? 'failed'}`].filter(Boolean).join('; ');
    }
    byTown.set(r.townId, cur);
  }
  return [...byTown.values()];
}
