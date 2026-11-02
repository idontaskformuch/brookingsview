/** Forecast presentation shared by the build (pages/weather.astro, the sign strip in layouts/BaseLayout.astro) and the browser
 *  (lib/live-weather.ts, fed by /api/weather). One implementation, so a page refreshed in the browser reads exactly like the built one. */
import { formatClockCompact } from './country-profile';

export interface FPeriod {
  name?: string | null;
  start: string | null;
  temp: number | null;
  unit: string | null;
  short: string | null;
  wind: string | null;
  is_daytime: boolean | null;
}

export interface YMD { y: number; m: number; d: number }

export function localYMD(instant: Date, tz: string): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function daysBetween(a: YMD, b: YMD): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The source's own period name replaced by one counted from the reader's local "today" (a snapshot can be older than the page). */
export function relabelPeriod(p: Pick<FPeriod, 'start' | 'is_daytime' | 'name'>, tz: string, now: Date): string {
  if (!p.start) return p.name ?? '';
  const periodYMD = localYMD(new Date(p.start), tz);
  const offset = daysBetween(localYMD(now, tz), periodYMD);
  if (offset === 0) return p.is_daytime ? 'Today' : 'Tonight';
  if (offset === 1) return p.is_daytime ? 'Tomorrow' : 'Tomorrow Night';
  if (offset < 0) return p.name ?? '';
  const dow = WEEKDAYS[new Date(Date.UTC(periodYMD.y, periodYMD.m - 1, periodYMD.d)).getUTCDay()];
  return p.is_daytime ? dow : `${dow} Night`;
}

/** UK: "7pm", US: "7 PM". */
export function hourLabel(start: string, tz: string, country: string): string {
  if (country === 'gb') return formatClockCompact(new Date(start), tz);
  return new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: tz });
}

/** Hours that are already over are dropped, so the strip starts at "now". */
export function upcomingHours<T extends { start: string | null }>(hourly: T[], now: Date): T[] {
  return hourly.filter((h) => h.start && new Date(h.start).getTime() >= now.getTime() - 3_600_000).slice(0, 24);
}

/** Day-periods that started on an earlier local day are dropped, so "Tonight" is not listed twice. */
export function currentPeriods<T extends { start: string | null }>(periods: T[], tz: string, now: Date): T[] {
  const today = localYMD(now, tz);
  return periods.filter((p) => !p.start || daysBetween(today, localYMD(new Date(p.start), tz)) >= 0);
}

/** /today's one-line forecast: "Today: 14°C cloudy. Tonight: 8°C clear." from the first two periods that are not in the past. '' when there is none. */
export function forecastLine(periods: FPeriod[], tz: string, now: Date): string {
  const text = currentPeriods(periods, tz, now)
    .filter((p) => p.temp !== null && p.temp !== undefined)
    .slice(0, 2)
    .map((p) => `${relabelPeriod(p, tz, now)}: ${Math.round(p.temp as number)}°${p.unit ?? ''}${p.short ? ` ${p.short.toLowerCase()}` : ''}`)
    .join('. ');
  return text ? `${text}.` : '';
}

export interface SignWeather { temp: number; unit: string; isDaytime: boolean; conditions: string | null }

/** The sign strip's weather item: the first daytime period (db.ts getSignData), else the first period. */
export function signWeather(periods: FPeriod[]): SignWeather | null {
  const current = periods.find((p) => p.is_daytime) ?? periods[0] ?? null;
  if (!current || current.temp === null || current.temp === undefined) return null;
  return { temp: current.temp, unit: current.unit ?? 'F', isDaytime: current.is_daytime ?? true, conditions: current.short ?? null };
}

/** "High 54°F mostly cloudy" (non-breaking spaces, as the strip prints it). */
export function signWeatherText(w: SignWeather): string {
  return `${w.isDaytime ? 'High' : 'Low'} ${Math.round(w.temp)}°${w.unit}${w.conditions ? ` ${w.conditions.toLowerCase()}` : ''}`;
}

/** CityStatus' Weather row: "High 54°F, Mostly Cloudy" (lib/cityStatus.ts weatherValueLabel uses this too, so the build and the
 *  browser print the same thing). */
export function statusWeatherText(w: SignWeather): string {
  return `${w.isDaytime ? 'High' : 'Low'} ${Math.round(w.temp)}°${w.unit}, ${w.conditions ?? ''}`;
}

/** /this-weekend's forecast: "Friday: 12°C light rain. Saturday: 11°C cloudy. Sunday: 9°C sunny." One part per local day number in
 *  `days` (days since epoch) that the forecast covers: the day period, or the night period when the day period is already over
 *  (Friday evening). A day the forecast does not reach is left out; '' when none is covered. */
export function weekendForecastLine(periods: FPeriod[], tz: string, now: Date, days: number[]): string {
  const dayOf = (p: FPeriod) => { const y = localYMD(new Date(p.start as string), tz); return Date.UTC(y.y, y.m - 1, y.d) / 86_400_000; };
  const usable = periods.filter((p) => p.start && p.temp !== null && p.temp !== undefined && new Date(p.start).getTime() + 12 * 3_600_000 > now.getTime());
  const parts = days.map((day) => {
    const mine = usable.filter((p) => dayOf(p) === day);
    const p = mine.find((x) => x.is_daytime) ?? mine[0];
    if (!p) return '';
    const name = WEEKDAYS[new Date(day * 86_400_000).getUTCDay()];
    return `${name}${p.is_daytime ? '' : ' night'}: ${Math.round(p.temp as number)}°${p.unit ?? ''}${p.short ? ` ${p.short.toLowerCase()}` : ''}`;
  }).filter(Boolean);
  return parts.length ? `${parts.join('. ')}.` : '';
}
