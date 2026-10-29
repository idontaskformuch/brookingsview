/** Current air quality from AirNow (EPA). Needs AIRNOW_API_KEY; without it this part stays off. The data is preliminary ("not fully verified
 *  or validated"): the page says so and links airnow.gov. We store the source's own number, category and time; no health advice of our own.
 *  The overall AQI is the highest parameter reported (EPA's rule). */
import type { SafetyTown } from './towns';

export const AIRNOW_API = 'https://www.airnowapi.org/aq/observation/latLong/current/';
export const AIRNOW_PUBLIC_URL = 'https://www.airnow.gov/';

export interface AirNotice {
  externalId: 'aqi';
  title: string;
  url: string;
  observedAt: string;
  raw: { aqi: number; category: string; categoryNumber: number; parameter: string; reportingArea: string; observedLocal: string; source: 'AirNow' };
}

interface AirNowRow {
  DateObserved?: string; HourObserved?: number; LocalTimeZone?: string; ReportingArea?: string; ParameterName?: string; AQI?: number;
  Category?: { Number?: number; Name?: string };
}

/** Offset in hours of the zone abbreviations AirNow reports in LocalTimeZone. */
const OFFSETS: Record<string, number> = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10 };

/** Highest-AQI row as a notice, or null when there is no usable, recent reading (an undatable reading is never shown). */
export function parseAirNow(body: unknown, now: Date, maxAgeHours = 3): AirNotice | null {
  if (!Array.isArray(body)) throw new Error('AirNow: not an array');
  let best: AirNowRow | null = null;
  for (const r of body as AirNowRow[]) {
    if (typeof r.AQI !== 'number' || r.AQI < 0 || !r.Category?.Name || !r.DateObserved || typeof r.HourObserved !== 'number') continue;
    if (!best || r.AQI > (best.AQI as number)) best = r;
  }
  if (!best) return null;
  const off = OFFSETS[String(best.LocalTimeZone ?? '').toUpperCase()];
  if (off === undefined) return null;
  const [y, m, d] = String(best.DateObserved).trim().split('-').map(Number);
  const hour = best.HourObserved as number;
  const observed = new Date(Date.UTC(y, m - 1, d, hour - off));
  if (Number.isNaN(observed.getTime()) || now.getTime() - observed.getTime() > maxAgeHours * 3_600_000 || observed.getTime() > now.getTime() + 3_600_000) return null;
  return {
    externalId: 'aqi', title: `Air quality: ${best.ReportingArea ?? 'nearest reporting area'}`, url: AIRNOW_PUBLIC_URL, observedAt: observed.toISOString(),
    raw: {
      aqi: best.AQI as number, category: best.Category!.Name as string, categoryNumber: best.Category!.Number ?? 0, parameter: String(best.ParameterName ?? ''),
      reportingArea: String(best.ReportingArea ?? ''), observedLocal: `${best.DateObserved} ${String(hour).padStart(2, '0')}:00 ${best.LocalTimeZone}`, source: 'AirNow',
    },
  };
}

/** Null = no current reading (the page then shows nothing). Throws on a non-200 so stored rows are left alone. */
export async function fetchAir(town: SafetyTown, apiKey: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<AirNotice | null> {
  const q = new URLSearchParams({ format: 'application/json', latitude: String(town.lat), longitude: String(town.lon), distance: String(town.radiusMiles), API_KEY: apiKey });
  const res = await fetcher(`${AIRNOW_API}?${q}`, { headers: { 'User-Agent': 'ViewMediaBot/1.0 (+https://brookingsview.com/contact)' } });
  if (res.status !== 200) throw new Error(`AirNow ${town.townId} -> HTTP ${res.status}`); // never echo the URL: it carries the key
  return parseAirNow(await res.json(), now);
}
