/** Part of the 15-minute tick: wildfires (always) and air quality (only when AIRNOW_API_KEY is set) for each town in SAFETY_TOWNS.
 *  One town or one source failing never stops the others; a failed fetch writes nothing. */
import type { Sql } from '../alerts/store';
import { fetchAir } from './airnow';
import { storeNotices } from './store';
import { SAFETY_TOWNS, type SafetyTown } from './towns';
import { fetchFires } from './wfigs';

export interface SafetyEnv { AIRNOW_API_KEY?: string }
export interface SafetyResult { townId: string; part: 'fire' | 'air'; ok: boolean; written?: number; ended?: number; skipped?: string; error?: string }

export async function refreshSafety(env: SafetyEnv, deps: { sql: Sql; now?: Date; fetcher?: typeof fetch; towns?: SafetyTown[] }): Promise<SafetyResult[]> {
  const out: SafetyResult[] = [];
  const now = deps.now ?? new Date();
  for (const town of deps.towns ?? SAFETY_TOWNS) {
    try {
      const fires = await fetchFires(town, now, deps.fetcher);
      out.push({ townId: town.townId, part: 'fire', ok: true, ...(await storeNotices(deps.sql, town.townId, 'fire', fires)) });
    } catch (e) {
      out.push({ townId: town.townId, part: 'fire', ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
    const key = env.AIRNOW_API_KEY;
    if (!key) { out.push({ townId: town.townId, part: 'air', ok: true, skipped: 'AIRNOW_API_KEY not set' }); continue; }
    try {
      const air = await fetchAir(town, key, now, deps.fetcher);
      out.push({ townId: town.townId, part: 'air', ok: true, ...(await storeNotices(deps.sql, town.townId, 'air', air ? [air] : [])) });
    } catch (e) {
      out.push({ townId: town.townId, part: 'air', ok: false, error: String((e as Error)?.message ?? e).slice(0, 300).split(key).join('***') });
    }
  }
  return out;
}
