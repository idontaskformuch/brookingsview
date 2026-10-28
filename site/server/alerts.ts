/** GET /api/alerts -- the weather/county alerts that are in force NOW for the town the request's hostname belongs to (US towns; Glasgow's Met Office
 *  warnings have their own /api/weather-warnings). Read-only, official text only (NWS headline/description, never reworded).
 *
 *  Why: the pages are static and a new alert used to wait for the next build. The cron-dispatcher Worker now writes NWS alerts to the
 *  database every 15 minutes (cron-dispatcher/src/alerts/); the browser asks this endpoint and shows what the build could not know.
 *  Same "in force" rule as every other alert surface (src/lib/alerts.ts). */
import { neon } from '@neondatabase/serverless';
import { activeAlerts } from '../src/lib/alerts';
import { townFromHostname, timezoneForTown, type Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' };
const US_ALERT_TOWNS = new Set(['brookings_sd', 'moreno_valley_ca', 'broomfield_co']);

export interface AlertDbRow {
  id: number;
  title: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  source: string | null;
  url: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string | Date | null;
}

export interface PublicAlert {
  id: number;
  source: string;
  event: string;
  headline: string;
  description: string;
  instruction: string | null;
  severity: string | null;
  startsAt: string | null;
  endsAt: string;
  url: string | null;
  firstSeen: string | null;
}

export interface AlertsDeps {
  now?: () => Date;
  loadRows?: (databaseUrl: string, townId: string) => Promise<AlertDbRow[]>;
}

const iso = (v: string | Date | null): string | null => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function toPublicAlerts(rows: AlertDbRow[], now: Date, timezone: string): PublicAlert[] {
  const live = activeAlerts(
    rows.map((r) => ({
      row: r,
      ends_at: iso(r.ends_at),
      starts_at: iso(r.starts_at),
      title: r.title ?? '',
      body: typeof r.raw_data?.description === 'string' ? (r.raw_data.description as string) : typeof r.raw_data?.body === 'string' ? (r.raw_data.body as string) : null,
      source: r.source,
      category: typeof r.raw_data?.category === 'string' ? (r.raw_data.category as string) : null,
    })),
    now,
    timezone,
  );
  return live.map(({ row, endsAt }) => ({
    id: row.id,
    source: row.source ?? '',
    event: row.title ?? '',
    headline: text(row.raw_data?.headline ?? row.title, 300),
    description: text(row.raw_data?.description ?? row.raw_data?.body, 1500),
    instruction: row.raw_data?.instruction ? text(row.raw_data.instruction, 1000) : null,
    severity: row.raw_data?.severity ? String(row.raw_data.severity) : null,
    startsAt: iso(row.starts_at),
    endsAt: endsAt.toISOString(),
    url: row.url,
    firstSeen: iso(row.created_at),
  }));
}

export async function handleAlerts(request: Request, env: Env, deps: AlertsDeps = {}): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (!townId) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: HEADERS });
  const now = (deps.now ?? (() => new Date()))();
  if (!US_ALERT_TOWNS.has(townId)) return new Response(JSON.stringify({ town: townId, alerts: [] }), { headers: HEADERS });
  const load = deps.loadRows ?? (async (url: string, t: string) => {
    const sql = neon(url);
    return (await sql`
      SELECT id, title, starts_at, ends_at, source, url, raw_data, created_at FROM events
       WHERE town_id = ${t} AND source IN ('nws_alert', 'county_alert')
         AND (ends_at > now() OR (ends_at IS NULL AND starts_at > now() - interval '24 hours'))`) as unknown as AlertDbRow[];
  });
  return new Response(JSON.stringify({ town: townId, alerts: toPublicAlerts(await load(env.DATABASE_URL, townId), now, timezoneForTown(townId)) }), { headers: HEADERS });
}
