/** NWS forecast for a point -- port of scrapers/parsers/noaa.py (same payload: {periods (14), hourly (24)}). */
import { USER_AGENT } from '../alerts/nws';
import { num, pyRound } from './util';

export const NWS_API = 'https://api.weather.gov';
const MAX_PERIODS = 14;
const MAX_HOURLY = 24;

export interface WeatherPeriod {
  name?: string | null;
  start: string | null;
  temp: number | null;
  unit: string | null;
  short: string | null;
  wind: string | null;
  is_daytime: boolean | null;
  /** Optional, present only when the source has a number: chance of precipitation %, "feels like" (payload unit), gust mph, UV index, precipitation mm. */
  pop?: number;
  feels?: number;
  gust?: number;
  uv?: number;
  precip_mm?: number;
}
export interface WeatherPayload {
  periods: WeatherPeriod[];
  hourly: Omit<WeatherPeriod, 'name'>[];
  issued?: string | null;
  source?: string;
  /** When we fetched the forecast (UTC, ISO). The page prints "Updated" from this. */
  fetched_at?: string;
}

type Raw = { properties?: { periods?: Record<string, any>[] } };

/** Chance of precipitation in %: NWS sends { unitCode, value } and the value is null when it has none. Key left out then. */
const popOf = (p: Record<string, any>): { pop?: number } => {
  const v = num(p.probabilityOfPrecipitation?.value);
  return v === null ? {} : { pop: pyRound(v) };
};

/** `nowMs` is when the forecast was fetched (stored as fetched_at); a caller without one gets no fetched_at. */
export function normalizeNws(forecast: Raw, hourly: Raw, nowMs?: number): WeatherPayload {
  const periods = (forecast.properties?.periods ?? []).slice(0, MAX_PERIODS).map((p) => ({
    name: p.name ?? null, start: p.startTime ?? null, temp: p.temperature ?? null, unit: p.temperatureUnit ?? null,
    short: p.shortForecast ?? null, wind: p.windSpeed ?? null, is_daytime: p.isDaytime ?? null, ...popOf(p),
  }));
  const hours = (hourly.properties?.periods ?? []).slice(0, MAX_HOURLY).map((p) => ({
    start: p.startTime ?? null, temp: p.temperature ?? null, unit: p.temperatureUnit ?? null,
    short: p.shortForecast ?? null, wind: p.windSpeed ?? null, is_daytime: p.isDaytime ?? null, ...popOf(p),
  }));
  return nowMs === undefined ? { periods, hourly: hours } : { periods, hourly: hours, fetched_at: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** Throws on any non-200 or an empty forecast: the caller then keeps the stored snapshot. */
export async function fetchNwsForecast(lat: number, lon: number, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<WeatherPayload> {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' };
  const get = async (url: string): Promise<any> => {
    const r = await fetcher(url, { headers });
    if (r.status !== 200) throw new Error(`${url} -> HTTP ${r.status}`);
    return r.json();
  };
  const points = await get(`${NWS_API}/points/${lat},${lon}`);
  const props = points?.properties;
  if (!props?.forecast || !props?.forecastHourly) throw new Error('NWS points answer without forecast URLs');
  const [forecast, hourly] = await Promise.all([get(props.forecast), get(props.forecastHourly)]);
  const payload = normalizeNws(forecast, hourly, nowMs);
  if (!payload.periods.length) throw new Error('NWS forecast without periods');
  return payload;
}
