/** GET /api/weather-warnings -- the Met Office warnings (events.source = 'met_office_warning', written by
 *  scrapers/parsers/met_office_warnings_v1.py) that are in force for the town the request's hostname belongs
 *  to. Read-only; a new or cancelled warning reaches the page without a rebuild. The town comes from the
 *  HOSTNAME only. Towns without warnings get an empty list and no database read. */
import { neon } from '@neondatabase/serverless';
import { isInForce, sortWarnings, type PublicWarning, type WarningLevel } from '../src/lib/met-warnings';
import { townFromHostname, type Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' };
const TOWNS_WITH_WARNINGS = new Set(['glasgow']);
const LEVELS = new Set(['yellow', 'amber', 'red']);
const PUBLIC_URL = 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings';

export interface WarningRow { url: string | null; starts_at: string | Date | null; ends_at: string | Date | null; raw_data: Record<string, unknown> | null }

export interface WeatherWarningsDeps {
  now?: () => Date;
  loadRows?: (databaseUrl: string, townId: string) => Promise<WarningRow[]>;
}

const iso = (v: string | Date | null): string => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Rows -> public warnings. Only status ISSUED, a known level and a valid-to in the future survive. */
export function toPublicWarnings(rows: WarningRow[], now: Date): PublicWarning[] {
  const out: PublicWarning[] = [];
  for (const row of rows) {
    const d = row.raw_data ?? {};
    if (d.status !== 'ISSUED' || !LEVELS.has(String(d.level)) || !d.warning_id) continue;
    const w: PublicWarning = {
      id: String(d.warning_id),
      level: d.level as WarningLevel,
      weatherTypes: strings(d.weather_types),
      headline: String(d.headline ?? ''),
      validFrom: iso(row.starts_at),
      validTo: iso(row.ends_at),
      whatToExpect: strings(d.what_to_expect),
      whatShouldIDo: d.what_should_i_do ? String(d.what_should_i_do) : null,
      sourceName: 'Met Office',
      sourceUrl: row.url ?? PUBLIC_URL,
    };
    if (w.validFrom && w.validTo && isInForce(w, now)) out.push(w);
  }
  return sortWarnings(out);
}

export async function handleWeatherWarnings(request: Request, env: Env, deps: WeatherWarningsDeps = {}): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (!townId) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: HEADERS });
  const now = (deps.now ?? (() => new Date()))();
  if (!TOWNS_WITH_WARNINGS.has(townId)) return new Response(JSON.stringify({ town: townId, warnings: [] }), { headers: HEADERS });
  const load = deps.loadRows ?? (async (url: string, t: string) => {
    const sql = neon(url);
    return (await sql`
      SELECT url, starts_at, ends_at, raw_data FROM events
       WHERE town_id = ${t} AND source = 'met_office_warning'
         AND raw_data->>'status' = 'ISSUED' AND ends_at > now()`) as unknown as WarningRow[];
  });
  return new Response(JSON.stringify({ town: townId, warnings: toPublicWarnings(await load(env.DATABASE_URL, townId), now) }), { headers: HEADERS });
}
