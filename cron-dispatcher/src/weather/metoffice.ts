/** Met Office DataHub Site Specific forecast -- port of scrapers/parsers/met_office_site_specific_v1.py (same payload and rounding).
 *  tests/fixtures/met_office_payload.json is produced by the Python builder from the same input; test/weather.test.ts requires equality. */
import type { WeatherPayload } from './nws';
import { num, pyRound, round1 } from './util';

export const API = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point';
const MAX_HOURLY = 24;
const MAX_PERIODS = 14;
const MS_TO_MPH = 2.2369363;
// Optional payload fields (older stored payloads lack them, and the page copes): pop = chance of precipitation in %, feels = "feels like" in the
// payload unit, gust = gust speed in mph, uv = UV index, precip_mm = rain/snow water in the hour.

const WEATHER_TEXT: Record<number, string> = {
  0: 'Clear', 1: 'Sunny', 2: 'Partly cloudy', 3: 'Partly cloudy', 5: 'Mist', 6: 'Fog', 7: 'Cloudy', 8: 'Overcast',
  9: 'Light rain showers', 10: 'Light rain showers', 11: 'Drizzle', 12: 'Light rain', 13: 'Heavy rain showers', 14: 'Heavy rain showers',
  15: 'Heavy rain', 16: 'Sleet showers', 17: 'Sleet showers', 18: 'Sleet', 19: 'Hail showers', 20: 'Hail showers', 21: 'Hail',
  22: 'Light snow showers', 23: 'Light snow showers', 24: 'Light snow', 25: 'Heavy snow showers', 26: 'Heavy snow showers',
  27: 'Heavy snow', 28: 'Thunder showers', 29: 'Thunder showers', 30: 'Thunder',
};
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weatherText = (code: unknown): string => {
  if (code == null) return '—'; // Python: int(None) fails -> the dash
  const n = Number(code);
  return Number.isInteger(n) && WEATHER_TEXT[n] ? WEATHER_TEXT[n] : '—';
};
export const compass = (deg: unknown): string => {
  const n = Number(deg);
  return deg == null || !Number.isFinite(n) ? '' : COMPASS[((pyRound(n / 22.5) % 16) + 16) % 16];
};
export const windText = (speedMs: unknown, fromDeg: unknown): string => {
  const n = Number(speedMs);
  if (speedMs == null || !Number.isFinite(n)) return '';
  return `${pyRound(n * MS_TO_MPH)} mph ${compass(fromDeg)}`.trim();
};

/** Approximate solar elevation (degrees) at a UTC instant; plenty for a day/night flag. */
export function sunAltitudeDeg(whenMs: number, lat: number, lon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const d = (whenMs - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  const meanLon = mod(280.46 + 0.9856474 * d, 360);
  const g = rad(mod(357.528 + 0.9856003 * d, 360));
  const lam = rad(meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * d);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmstHours = mod(18.697374558 + 24.06570982441908 * d, 24);
  const hourAngle = rad(mod(gmstHours * 15 + lon, 360)) - ra;
  const phi = rad(lat);
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  return (alt * 180) / Math.PI;
}
export const isDaytime = (whenMs: number, lat: number, lon: number): boolean => sunAltitudeDeg(whenMs, lat, lon) > -0.833;

/** "2026-10-23T17:00Z" -> ms */
const parseTime = (t: string): number => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)Z$/.exec(t);
  if (!m) throw new Error(`bad Met Office time ${t}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
};
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const temp = (v: unknown): number | null => (v == null ? null : pyRound(Number(v)));

/** Optional fields: a key is only present when the source has a number for it. */
type Extras = { pop?: number; feels?: number; gust?: number; uv?: number; precip_mm?: number };
const extras = (o: { pop?: unknown; feels?: unknown; gustMs?: unknown; uv?: unknown; precip?: unknown }): Extras => {
  const out: Extras = {};
  const pop = num(o.pop), feels = num(o.feels), gust = num(o.gustMs), uv = num(o.uv), precip = num(o.precip);
  if (pop !== null) out.pop = pyRound(pop);
  if (feels !== null) out.feels = pyRound(feels);
  if (gust !== null) out.gust = pyRound(gust * MS_TO_MPH);
  if (uv !== null) out.uv = pyRound(uv);
  if (precip !== null) out.precip_mm = round1(precip);
  return out;
};

/** Offset (ms) of `tz` from UTC at an instant. */
function tzOffsetMs(tz: string, atMs: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(atMs / 1000) * 1000;
}
/** UTC ms of local wall-clock y-m-d h:00 in `tz`. */
function localToUtcMs(y: number, mo: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return t;
}
const localDate = (ms: number, tz: string): { y: number; m: number; d: number } => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
};

type Doc = { features?: { properties?: { modelRunDate?: string; timeSeries?: Record<string, any>[] } }[] };
const series = (doc: Doc): [Record<string, any>[], string | null] => {
  const props = doc.features?.[0]?.properties ?? {};
  return [props.timeSeries ?? [], props.modelRunDate ?? null];
};

export function buildPayload(hourlyDoc: Doc, dailyDoc: Doc, nowMs: number, lat: number, lon: number, tz: string): WeatherPayload {
  const [hourlySeries, runH] = series(hourlyDoc);
  const [dailySeries, runD] = series(dailyDoc);
  const hourFloor = Math.floor(nowMs / 3_600_000) * 3_600_000;
  const hourly: WeatherPayload['hourly'] = [];
  for (const pt of hourlySeries) {
    const when = parseTime(pt.time);
    if (when < hourFloor) continue;
    hourly.push({
      start: iso(when), temp: temp(pt.screenTemperature), unit: 'C', short: weatherText(pt.significantWeatherCode),
      wind: windText(pt.windSpeed10m, pt.windDirectionFrom10m), is_daytime: isDaytime(when, lat, lon),
      ...extras({ pop: pt.probOfPrecipitation, feels: pt.feelsLikeTemperature, gustMs: pt.windGustSpeed10m, uv: pt.uvIndex, precip: pt.totalPrecipAmount }),
    });
    if (hourly.length === MAX_HOURLY) break;
  }
  const today = localDate(nowMs, tz);
  const todayKey = Date.UTC(today.y, today.m - 1, today.d);
  const periods: NonNullable<WeatherPayload['periods']> = [];
  for (const pt of dailySeries) {
    const day = new Date(parseTime(pt.time));
    const dayKey = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    if (dayKey < todayKey) continue;
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    const dayStart = localToUtcMs(y, mo, d, 6, tz);
    const nightStart = localToUtcMs(y, mo, d, 18, tz);
    const weekday = WEEKDAYS[day.getUTCDay()];
    const isToday = dayKey === todayKey;
    if (!(isToday && nowMs >= nightStart)) {
      periods.push({
        name: isToday ? 'Today' : weekday, start: iso(dayStart), temp: temp(pt.dayMaxScreenTemperature), unit: 'C',
        short: weatherText(pt.daySignificantWeatherCode), wind: windText(pt.midday10MWindSpeed, pt.midday10MWindDirection), is_daytime: true,
        ...extras({ pop: pt.dayProbabilityOfPrecipitation, feels: pt.dayMaxFeelsLikeTemp, gustMs: pt.midday10MWindGust, uv: pt.maxUvIndex }),
      });
    }
    periods.push({
      name: isToday ? 'Tonight' : `${weekday} Night`, start: iso(nightStart), temp: temp(pt.nightMinScreenTemperature), unit: 'C',
      short: weatherText(pt.nightSignificantWeatherCode), wind: windText(pt.midnight10MWindSpeed, pt.midnight10MWindDirection), is_daytime: false,
      ...extras({ pop: pt.nightProbabilityOfPrecipitation, feels: pt.nightMinFeelsLikeTemp, gustMs: pt.midnight10MWindGust }),
    });
    if (periods.length >= MAX_PERIODS) break;
  }
  return { periods: periods.slice(0, MAX_PERIODS), hourly, issued: runH ?? runD, source: 'Met Office', fetched_at: iso(nowMs) };
}

/** Waits between retries of a failed Met Office request (ms). Met Office answered HTTP 500 to the hourly request at 10:00 and 12:00 UTC on
 *  2026-10-28, i.e. right at the whole hour when it publishes a new model run; a few patient retries cover that. Tests pass zeros. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** An authentication problem, not an outage: 401/403, or the gateway's own auth codes (WSO2 9009xx: 900900 "Unclassified Authentication
 *  Failure" arrives as HTTP 500, 900901 invalid credentials, 900908 resource forbidden). Seen 2026-10-28: a malformed stored key made every
 *  hourly request answer 500/900900, and four retries only repeated it. Never retried. */
export function isAuthFailure(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  const code = /"code"\s*:\s*"?(\d+)"?/.exec(bodyText)?.[1];
  return !!code && code.startsWith('9009');
}

/** What the error message carries about a failed answer: status, the first 200 characters of the body and a few headers. The key is never in
 *  a URL or a header we print. */
async function describeFailure(label: string, r: Response, attempts: number): Promise<{ message: string; auth: boolean }> {
  const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
  const hdr = ['content-type', 'retry-after', 'via', 'x-request-id'].map((k) => (r.headers.get(k) ? `${k}=${r.headers.get(k)}` : '')).filter(Boolean).join(' ');
  const auth = isAuthFailure(r.status, body);
  const head = auth ? `Met Office ${label} -> auth failure (HTTP ${r.status}, not retried): check MET_OFFICE_API_KEY on the Worker` : `Met Office ${label} -> HTTP ${r.status} after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
  return { message: `${head}; body: ${body || '(empty)'}${hdr ? `; ${hdr}` : ''}`, auth };
}

/** Throws on a non-200 or empty answer: the caller then keeps the stored snapshot. A real 5xx or a network error is retried (RETRY_DELAYS_MS);
 *  an auth failure (see isAuthFailure) and any 4xx are not. */
export async function fetchMetOfficeForecast(
  lat: number, lon: number, tz: string, apiKey: string, fetcher: typeof fetch = fetch, nowMs = Date.now(), delays: number[] = RETRY_DELAYS_MS,
): Promise<WeatherPayload> {
  const get = async (kind: 'hourly' | 'daily'): Promise<Doc> => {
    let lastError = '';
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        const r = await fetcher(`${API}/${kind}?latitude=${lat}&longitude=${lon}`, { headers: { apikey: apiKey, Accept: 'application/json', 'User-Agent': 'ViewMediaBot/1.0 (+https://glasgowloop.co.uk)' } });
        if (r.status === 200) return (await r.json()) as Doc;
        const failure = await describeFailure(kind, r, attempt + 1);
        lastError = failure.message;
        if (failure.auth || r.status < 500) break; // an auth failure or a 4xx will not get better; only a real 5xx is retried
      } catch (e) {
        lastError = `Met Office ${kind} -> network error after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
      }
    }
    throw new Error(lastError);
  };
  const [hourly, daily] = [await get('hourly'), await get('daily')];
  const payload = buildPayload(hourly, daily, nowMs, lat, lon, tz);
  if (!payload.periods.length) throw new Error('Met Office forecast without periods');
  return payload;
}
