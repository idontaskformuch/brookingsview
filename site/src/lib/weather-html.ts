/** The weather page's answer block as markup: hero, insight lines, next 24 hours, week ahead. pages/weather.astro writes it at build time and
 *  lib/live-weather.ts rewrites it in the browser from a newer forecast, both through these functions, so they cannot drift apart. */
import { clockLabel, hourLabel, localYMD } from './weather-format';
import { buildWeatherView, type WeatherEnv, type WeatherView, type WxInput } from './weather-model';
import { dayRowsHtml, heroHtml, hourStripHtml, insightHtml, sectionHeaderHtml } from './ui/ui-html';

/** What the browser needs to rebuild the view: embedded in the page as JSON (data-weather-config). */
export interface WeatherConfig {
  unit: 'F' | 'C';
  lat: number;
  lon: number;
  tz: string;
  country: string;
  /** Yesterday's forecast high, valid only for the local date `for` (the build's "today"): a page read the next day must not use it. */
  yesterday?: { for: string; value: number } | null;
}

export function weatherEnv(cfg: WeatherConfig, now: Date): WeatherEnv {
  const y = localYMD(now, cfg.tz);
  const today = `${y.y}-${String(y.m).padStart(2, '0')}-${String(y.d).padStart(2, '0')}`;
  return {
    now, tz: cfg.tz, unit: cfg.unit, lat: cfg.lat, lon: cfg.lon,
    hourLabel: (d) => hourLabel(d.toISOString(), cfg.tz, cfg.country),
    clock: (d) => clockLabel(d, cfg.tz, cfg.country),
    yesterdayHigh: cfg.yesterday && cfg.yesterday.for === today ? cfg.yesterday.value : null,
  };
}

export function viewFor(input: WxInput, cfg: WeatherConfig, now: Date): WeatherView {
  return buildWeatherView(input, weatherEnv(cfg, now));
}

/** The answer block. '' when there is nothing to show (the page then prints its own empty state). */
export function weatherRegionHtml(v: WeatherView): string {
  const parts: string[] = [];
  const h = v.hero;
  if (h) {
    const meta = [h.feels !== null ? `Feels like ${Math.round(h.feels)}°` : '', h.high !== null ? `High ${Math.round(h.high)}°` : '', h.low !== null ? `Low ${Math.round(h.low)}°` : '']
      .filter(Boolean).join(' · ');
    parts.push(heroHtml({
      label: h.label, value: `${Math.round(h.value)}°`, unit: h.unit, sub: h.conditions ?? undefined, meta: meta || undefined,
      icon: h.icon ?? undefined, iconLabel: h.conditions ?? undefined, rootAttrs: { 'data-wx-hero': '' },
    }));
  }
  if (v.insights.length) parts.push(`<div class="wx-insights">${v.insights.map((i) => insightHtml({ icon: i.icon, text: i.text, attrs: { 'data-wx-insight': i.id } })).join('')}</div>`);
  if (v.hours.length) {
    parts.push(sectionHeaderHtml({ title: 'Next 24 hours' }));
    parts.push(hourStripHtml(v.hours.map((x) => ({ time: x.time, temp: x.temp, icon: x.icon, short: x.short, pop: x.pop, current: x.current })), v.unit));
  }
  if (v.days.length) {
    parts.push(sectionHeaderHtml({ title: 'Week ahead' }));
    if (v.weekInsight) parts.push(`<div class="wx-insights">${insightHtml({ icon: 'calendar', text: v.weekInsight, attrs: { 'data-wx-insight': 'week' } })}</div>`);
    parts.push(dayRowsHtml(v.days, v.scale, v.unit));
  }
  return parts.join('');
}
