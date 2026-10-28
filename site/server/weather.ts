/** GET /api/weather -- the newest stored forecast for the town the request's hostname belongs to (weather_snapshots, written hourly by
 *  the cron-dispatcher Worker from the NWS / the Met Office, see cron-dispatcher/src/weather/). Read-only. The pages are built with the
 *  forecast of the last build as the fallback; the browser asks this endpoint (lib/live-weather.ts) and shows the newer one. The town comes
 *  from the HOSTNAME only. */
import { neon } from '@neondatabase/serverless';
import { townFromHostname, type Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

export interface SnapshotRow { payload: { periods?: unknown[]; hourly?: unknown[]; issued?: string | null; source?: string } | null; created_at?: string | Date | null }

export interface WeatherDeps {
  loadSnapshot?: (databaseUrl: string, townId: string) => Promise<SnapshotRow | null>;
}

export function toPublicWeather(townId: string, row: SnapshotRow | null) {
  const p = row?.payload ?? null;
  if (!p || !Array.isArray(p.periods) || p.periods.length === 0) return { town: townId, periods: [], hourly: [], issued: null, source: null };
  return {
    town: townId,
    periods: p.periods.slice(0, 14),
    hourly: Array.isArray(p.hourly) ? p.hourly.slice(0, 24) : [],
    issued: p.issued ?? (row?.created_at ? new Date(row.created_at).toISOString() : null),
    source: p.source ?? 'National Weather Service',
  };
}

export async function handleWeather(request: Request, env: Env, deps: WeatherDeps = {}): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (!townId) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: HEADERS });
  const load = deps.loadSnapshot ?? (async (url: string, t: string) => {
    const sql = neon(url);
    const rows = (await sql`
      SELECT payload, created_at FROM weather_snapshots WHERE town_id = ${t} ORDER BY observed_for DESC LIMIT 1`) as unknown as SnapshotRow[];
    return rows[0] ?? null;
  });
  return new Response(JSON.stringify(toPublicWeather(townId, await load(env.DATABASE_URL, townId))), { headers: HEADERS });
}
