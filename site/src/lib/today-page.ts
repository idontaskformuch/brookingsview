/** /today/ written into the HTML (Broomfield AdSense plan F3, owner yes 2026-11-12). For a town with SiteConfig.todayPage the page answers
 *  "what is on in <town> today?" without JavaScript: the date, today's forecast, today's meetings, today's hours, traffic incidents,
 *  today's events and what is open tonight. Each block is drawn only when it has something in it.
 *
 *  Indexing (owner, 2026-11-12): the page is indexable when at least `minBlocks` blocks have content. It stays noindex whatever the count
 *  before `indexFrom` and, with `requireOpenTonightData`, while "Open tonight" has no OpenStreetMap data for the town, so it does not flip
 *  index/noindex day by day before that block exists. Pure functions; pages/today.astro fetches. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WeatherPeriod, PlaceHoursRow, PlaceHoursException } from './db';
import { hoursOnDate, isPastStalenessThreshold } from './place-hours';
import { formatClock, isRoundTheClock } from './facility-hours';
import { calendarDateParts } from './calendar-date';

export interface TodayPageConfig {
  /** Blocks with content needed before the page is indexable. */
  minBlocks: number;
  /** Keep the page noindex while the town has no Open tonight data (no fresh OpenStreetMap snapshot). */
  requireOpenTonightData: boolean;
  /** YYYY-MM-DD: noindex before this town date whatever else holds (Broomfield 2026-11-19, owner 2026-11-12: a week to watch the blocks). */
  indexFrom?: string;
}

export const TODAY_BLOCKS = ['weather', 'meetings', 'hours', 'traffic', 'events', 'openTonight'] as const;
export type TodayBlockId = (typeof TODAY_BLOCKS)[number];

export interface TodayIndexVerdict {
  indexable: boolean;
  filled: TodayBlockId[];
  reason: 'before-index-date' | 'no-open-tonight-data' | 'too-few-blocks' | 'ok';
}

export function todayIndexVerdict(
  cfg: TodayPageConfig, filled: Partial<Record<TodayBlockId, boolean>>, openTonightHasData: boolean, todayIso: string,
): TodayIndexVerdict {
  const ids = TODAY_BLOCKS.filter((b) => filled[b]);
  if (cfg.indexFrom && todayIso < cfg.indexFrom) return { indexable: false, filled: ids, reason: 'before-index-date' };
  if (cfg.requireOpenTonightData && !openTonightHasData) return { indexable: false, filled: ids, reason: 'no-open-tonight-data' };
  if (ids.length < cfg.minBlocks) return { indexable: false, filled: ids, reason: 'too-few-blocks' };
  return { indexable: true, filled: ids, reason: 'ok' };
}

/** The town's calendar date: ISO for <time datetime>, and "Thursday, November 12" (en-US) / "Thursday 12 November" (en-GB). */
export function todayDate(now: Date, timezone: string, gb = false): { iso: string; label: string } {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const label = new Intl.DateTimeFormat(gb ? 'en-GB' : 'en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  return { iso, label };
}

/** The forecast periods that start on the town's today, in source order, as "This Afternoon: Sunny, high 67°F". Words are the source's
 *  (name, short); a daytime period's temperature is its high, a night's its low. A stale snapshot has no period for today: nothing shown. */
export function weatherToday(periods: WeatherPeriod[], now: Date, timezone: string): string[] {
  const { iso } = todayDate(now, timezone);
  return periods
    .filter((p) => p.start && todayDate(new Date(p.start), timezone).iso === iso)
    .map((p) => {
      const temp = p.temp === null ? '' : `, ${p.is_daytime ? 'high' : 'low'} ${p.temp}°${p.unit}`;
      return `${p.name}: ${p.short}${temp}`;
    });
}

export interface TodayHoursPlace {
  slug: string;
  name: string;
  /** places.verified_date: the Neon driver hands a DATE over as a Date (local midnight), not a string. */
  verified_date: string | Date | null;
  hours: PlaceHoursRow[];
  exceptions: PlaceHoursException[];
}

/** Today's hours for places with structured hours checked within `staleDays`: "9:00 AM–9:00 PM", "Open 24 hours" or "Closed today".
 *  A weekday nobody recorded is left out (unknown is not closed). Nothing on a public holiday: regular hours are not holiday hours. */
export function hoursToday(places: TodayHoursPlace[], now: Date, timezone: string, staleDays: number, holiday: boolean, gb = false): { slug: string; name: string; text: string }[] {
  if (holiday) return [];
  const { iso } = todayDate(now, timezone);
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const out: { slug: string; name: string; text: string }[] = [];
  for (const p of places) {
    const v = calendarDateParts(p.verified_date);
    const verified = v ? `${v.y}-${String(v.m + 1).padStart(2, '0')}-${String(v.d).padStart(2, '0')}` : null;
    if (p.hours.length === 0 || isPastStalenessThreshold(verified, staleDays, now)) continue;
    const day = hoursOnDate(iso, weekday, p.hours, p.exceptions);
    if (day === null) continue;
    const text = day === 'closed'
      ? 'Closed today'
      : day.map((w) => (isRoundTheClock(w.opens, w.closes) ? 'Open 24 hours' : `${formatClock(w.opens, gb)}–${formatClock(w.closes, gb)}`)).join(', ');
    out.push({ slug: p.slug, name: p.name, text });
  }
  return out;
}

/** The page's verdict for the sitemap filter in astro.config.mjs (same hand-off file as lib/traffic-verdict.ts), so tag and sitemap agree. */
export const TODAY_VERDICT_FILE = '.today-verdict.json';
export function writeTodayVerdict(townId: string, indexable: boolean): void {
  try { writeFileSync(resolve(process.cwd(), TODAY_VERDICT_FILE), JSON.stringify({ townId, indexable })); } catch { /* read-only: the filter then falls back to its own rule */ }
}
