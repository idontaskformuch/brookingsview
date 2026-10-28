/** Hourly forecast refresh: fetch each town's official forecast and write it to weather_snapshots (one row per town and UTC date,
 *  updated in place). Costs no GitHub Actions minutes. The pages read it through /api/weather in the browser; the forecast built into the
 *  HTML stays as the fallback. A failed fetch writes nothing (the stored snapshot stays). Same pattern as src/alerts/. */
import type { Sql } from '../alerts/store';
import { fetchMetOfficeForecast } from './metoffice';
import { fetchNwsForecast, type WeatherPayload } from './nws';
import { WEATHER_TOWNS, type WeatherTown } from './towns';

export interface WeatherEnv {
  DATABASE_URL: string;
  /** Met Office DataHub Site Specific key (the same MET_OFFICE_API_KEY the Python scraper uses). */
  MET_OFFICE_API_KEY?: string;
}

export interface WeatherResult {
  townId: string;
  ok: boolean;
  periods?: number;
  hourly?: number;
  error?: string;
}

/** weather_snapshots is UNIQUE (town_id, observed_for); observed_for is the UTC date, as noaa.py writes it (date.today() on a UTC runner). */
export async function storeWeather(sql: Sql, townId: string, payload: WeatherPayload, nowMs: number): Promise<void> {
  const observedFor = new Date(nowMs).toISOString().slice(0, 10);
  await sql`
    INSERT INTO weather_snapshots (town_id, observed_for, payload)
    VALUES (${townId}, ${observedFor}::date, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (town_id, observed_for) DO UPDATE SET payload = EXCLUDED.payload`;
}

export async function refreshWeather(
  env: WeatherEnv,
  deps: { sql: Sql; fetcher?: typeof fetch; towns?: WeatherTown[]; now?: () => number; retryDelaysMs?: number[] },
): Promise<WeatherResult[]> {
  const now = deps.now ?? Date.now;
  const results: WeatherResult[] = [];
  for (const town of deps.towns ?? WEATHER_TOWNS) {
    try {
      let payload: WeatherPayload;
      if (town.kind === 'nws') {
        payload = await fetchNwsForecast(town.lat, town.lon, deps.fetcher);
      } else {
        if (!env.MET_OFFICE_API_KEY) throw new Error('MET_OFFICE_API_KEY is not set');
        payload = await fetchMetOfficeForecast(town.lat, town.lon, town.timezone, env.MET_OFFICE_API_KEY, deps.fetcher, now(), deps.retryDelaysMs);
      }
      await storeWeather(deps.sql, town.townId, payload, now());
      results.push({ townId: town.townId, ok: true, periods: payload.periods.length, hourly: payload.hourly.length });
    } catch (e) {
      results.push({ townId: town.townId, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
  return results;
}
