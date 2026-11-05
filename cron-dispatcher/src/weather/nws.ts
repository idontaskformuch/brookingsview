/** NWS forecast for a point -- port of scrapers/parsers/noaa.py (same payload: {periods (14), hourly (24)}). */
import { USER_AGENT } from '../alerts/nws';
import { num, pyRound, round1 } from './util';

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

/** The NWS gridpoints answer (properties.apparentTemperature etc.): each series is a list of { validTime: "<start>/<ISO duration>", value }. */
export type GridSeries = { values?: { validTime?: string; value?: number | null }[] };
export type Gridpoints = { properties?: { apparentTemperature?: GridSeries; windGust?: GridSeries; quantitativePrecipitation?: GridSeries } };

/** "PT3H" / "P1DT6H" -> hours (whole hours only; anything else is not usable). */
export function isoHours(duration: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/.exec(duration);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0);
}

/** One value per UTC hour (key = ms of the hour): every hour an interval covers gets the interval's value. `onlyOneHour` keeps only
 *  intervals of exactly one hour (an amount over 6 hours cannot be split into hours without guessing). */
function perHour(series: GridSeries | undefined, onlyOneHour = false): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of series?.values ?? []) {
    const value = num(v.value);
    const [start, dur] = (v.validTime ?? '').split('/');
    const hours = dur ? isoHours(dur) : null;
    const t = Date.parse(start);
    if (value === null || hours === null || !Number.isFinite(t) || hours < 1 || hours > 48 || (onlyOneHour && hours !== 1)) continue;
    for (let h = 0; h < hours; h++) out.set(Math.floor(t / 3_600_000) * 3_600_000 + h * 3_600_000, value);
  }
  return out;
}

/** Adds feels (payload unit), gust (mph) and precip_mm (only where the source gives an hour's amount) to the hourly points that the
 *  gridpoints cover; the others stay as they are. Same arithmetic and rounding as noaa.py merge_gridpoints. */
export function mergeGridpoints(hourly: WeatherPayload['hourly'], grid: Gridpoints | null | undefined): WeatherPayload['hourly'] {
  const props = grid?.properties;
  if (!props) return hourly;
  const feels = perHour(props.apparentTemperature), gust = perHour(props.windGust), rain = perHour(props.quantitativePrecipitation, true);
  return hourly.map((h) => {
    const t = h.start ? Date.parse(h.start) : NaN;
    if (!Number.isFinite(t)) return h;
    const key = Math.floor(t / 3_600_000) * 3_600_000;
    const out = { ...h };
    const f = feels.get(key), g = gust.get(key), r = rain.get(key);
    if (f !== undefined && (h.unit === 'F' || h.unit === 'C')) out.feels = pyRound(h.unit === 'F' ? (f * 9) / 5 + 32 : f);
    if (g !== undefined) out.gust = pyRound(g * 0.621371);
    if (r !== undefined) out.precip_mm = round1(r);
    return out;
  });
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
  // Gridpoints (feels like, gusts) are a bonus: any failure here leaves the forecast without them, it never fails the refresh.
  if (typeof props.forecastGridData === 'string') {
    try { payload.hourly = mergeGridpoints(payload.hourly, await get(props.forecastGridData)); } catch { /* optional */ }
  }
  return payload;
}
