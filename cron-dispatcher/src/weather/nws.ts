/** NWS forecast for a point -- port of scrapers/parsers/noaa.py (same payload: {periods (14), hourly (24)}). */
import { USER_AGENT } from '../alerts/nws';

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
}
export interface WeatherPayload {
  periods: WeatherPeriod[];
  hourly: Omit<WeatherPeriod, 'name'>[];
  issued?: string | null;
  source?: string;
}

type Raw = { properties?: { periods?: Record<string, any>[] } };

export function normalizeNws(forecast: Raw, hourly: Raw): WeatherPayload {
  const periods = (forecast.properties?.periods ?? []).slice(0, MAX_PERIODS).map((p) => ({
    name: p.name ?? null, start: p.startTime ?? null, temp: p.temperature ?? null, unit: p.temperatureUnit ?? null,
    short: p.shortForecast ?? null, wind: p.windSpeed ?? null, is_daytime: p.isDaytime ?? null,
  }));
  const hours = (hourly.properties?.periods ?? []).slice(0, MAX_HOURLY).map((p) => ({
    start: p.startTime ?? null, temp: p.temperature ?? null, unit: p.temperatureUnit ?? null,
    short: p.shortForecast ?? null, wind: p.windSpeed ?? null, is_daytime: p.isDaytime ?? null,
  }));
  return { periods, hourly: hours };
}

/** Throws on any non-200 or an empty forecast: the caller then keeps the stored snapshot. */
export async function fetchNwsForecast(lat: number, lon: number, fetcher: typeof fetch = fetch): Promise<WeatherPayload> {
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
  const payload = normalizeNws(forecast, hourly);
  if (!payload.periods.length) throw new Error('NWS forecast without periods');
  return payload;
}
