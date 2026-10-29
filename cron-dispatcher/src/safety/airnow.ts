/** Current air quality from AirNow (EPA), /aq/observation/current/ziplatlong/ (the old observation/latLong/current/ was retired 2026-10-01).
 *  One row per monitor and pollutant ("Closest Reading By Pollutant", nearest monitor within 50 miles; the radius cannot be set). Needs
 *  AIRNOW_API_KEY; without it this part stays off. The data is preliminary ("not fully verified or validated"): the page says so and links
 *  airnow.gov. We store the source's own number and time, the category is EPA's own AQI breakpoints; no health advice of our own.
 *  The overall AQI is the highest pollutant reported (EPA's rule). */
import type { SafetyTown } from './towns';

export const AIRNOW_API = 'https://www.airnowapi.org/aq/observation/current/ziplatlong/';
export const AIRNOW_PUBLIC_URL = 'https://www.airnow.gov/';

export interface AirNotice {
  externalId: 'aqi';
  title: string;
  url: string;
  observedAt: string;
  raw: { aqi: number; category: string; categoryNumber: number; parameter: string; reportingArea: string; station: string; agency: string; observedLocal: string; source: 'AirNow' };
}

interface AirNowRow {
  dateObserved?: string; hourObserved?: string; localTimeZone?: string; reportingAreaName?: string; siteName?: string; reportingAgency?: string;
  parameterName?: string; nowcastAQI?: number | null;
}

/** EPA AQI breakpoints (the same everywhere): upper bound of each category and its name. Category number 1-6 is also the colour key. */
const BREAKPOINTS: Array<[number, string]> = [
  [50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for Sensitive Groups'], [200, 'Unhealthy'], [300, 'Very Unhealthy'], [Infinity, 'Hazardous'],
];
export function epaCategory(aqi: number): { number: number; name: string } {
  const i = BREAKPOINTS.findIndex(([max]) => aqi <= max);
  return { number: i + 1, name: BREAKPOINTS[i][1] };
}

/** Offset in hours of the zone abbreviations AirNow reports in localTimeZone. */
const OFFSETS: Record<string, number> = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10 };

/** Highest-AQI row as a notice, or null when there is no usable, recent reading (an undatable reading is never shown). */
export function parseAirNow(body: unknown, now: Date, maxAgeHours = 3): AirNotice | null {
  if (!Array.isArray(body)) throw new Error('AirNow: not an array');
  let best: AirNowRow | null = null;
  for (const r of body as AirNowRow[]) {
    if (typeof r.nowcastAQI !== 'number' || !Number.isFinite(r.nowcastAQI) || r.nowcastAQI < 0 || !r.dateObserved || !/^\d{1,2}:\d{2}$/.test(String(r.hourObserved))) continue;
    if (!best || r.nowcastAQI > (best.nowcastAQI as number)) best = r;
  }
  if (!best) return null;
  const off = OFFSETS[String(best.localTimeZone ?? '').toUpperCase()];
  if (off === undefined) return null;
  const [y, m, d] = String(best.dateObserved).trim().split('-').map(Number);
  const [hour, minute] = String(best.hourObserved).split(':').map(Number);
  const observed = new Date(Date.UTC(y, m - 1, d, hour - off, minute));
  if (Number.isNaN(observed.getTime()) || now.getTime() - observed.getTime() > maxAgeHours * 3_600_000 || observed.getTime() > now.getTime() + 3_600_000) return null;
  const aqi = best.nowcastAQI as number;
  const cat = epaCategory(aqi);
  const area = String(best.reportingAreaName ?? '').trim();
  return {
    externalId: 'aqi', title: `Air quality: ${area || 'nearest monitor'}`, url: AIRNOW_PUBLIC_URL, observedAt: observed.toISOString(),
    raw: {
      aqi, category: cat.name, categoryNumber: cat.number, parameter: String(best.parameterName ?? ''), reportingArea: area,
      station: String(best.siteName ?? ''), agency: String(best.reportingAgency ?? ''),
      observedLocal: `${best.dateObserved} ${best.hourObserved} ${best.localTimeZone}`, source: 'AirNow',
    },
  };
}

/** Null = no current reading (the page then shows nothing). Throws on a non-200 so stored rows are left alone. */
export async function fetchAir(town: SafetyTown, apiKey: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<AirNotice | null> {
  const q = new URLSearchParams({ format: 'application/json', latitude: String(town.lat), longitude: String(town.lon), API_KEY: apiKey });
  const res = await fetcher(`${AIRNOW_API}?${q}`, { headers: { 'User-Agent': 'ViewMediaBot/1.0 (+https://brookingsview.com/contact)' } });
  if (res.status !== 200) throw new Error(`AirNow ${town.townId} -> HTTP ${res.status}`); // never echo the URL: it carries the key
  return parseAirNow(await res.json(), now);
}
