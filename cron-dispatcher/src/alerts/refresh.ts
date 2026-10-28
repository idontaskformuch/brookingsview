/** The 15-minute job: fetch each town's official warnings and write them to the database. Costs no GitHub Actions minutes.
 *  The pages read them through /api/ in the browser (the build only renders a fallback). One town failing never stops the others;
 *  a failed fetch writes nothing (the stored rows stay and expire by their own end time). */
import { fetchMetOffice } from './metoffice';
import { fetchNws } from './nws';
import { storeMetOffice, storeNws, type Sql } from './store';
import { ALERT_TOWNS, type AlertTown } from './towns';

export interface AlertsEnv {
  DATABASE_URL: string;
  MET_OFFICE_WARNINGS_API_KEY?: string;
}

export interface TownResult {
  townId: string;
  ok: boolean;
  written?: number;
  ended?: number;
  error?: string;
}

export async function refreshAlerts(
  env: AlertsEnv,
  deps: { sql: Sql; fetcher?: typeof fetch; towns?: AlertTown[] },
): Promise<TownResult[]> {
  const results: TownResult[] = [];
  for (const town of deps.towns ?? ALERT_TOWNS) {
    try {
      if (town.kind === 'nws') {
        const records = await fetchNws(town.zones, deps.fetcher);
        const { written, ended } = await storeNws(deps.sql, town.townId, records);
        results.push({ townId: town.townId, ok: true, written, ended });
      } else {
        if (!env.MET_OFFICE_WARNINGS_API_KEY) throw new Error('MET_OFFICE_WARNINGS_API_KEY is not set');
        const records = await fetchMetOffice(town.lat, town.lon, env.MET_OFFICE_WARNINGS_API_KEY, deps.fetcher);
        const { written } = await storeMetOffice(deps.sql, town.townId, records);
        results.push({ townId: town.townId, ok: true, written });
      }
    } catch (e) {
      results.push({ townId: town.townId, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
  return results;
}
