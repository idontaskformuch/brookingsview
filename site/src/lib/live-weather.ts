/** Browser side of /api/weather (server/weather.ts). The forecast built into the page is the fallback; the cron-dispatcher Worker writes a
 *  fresh one every hour. When the API answers, the sign strip and (on /weather/) the whole answer block (hero, insights, hourly strip, week
 *  ahead: lib/weather-html.ts, the same markup the build wrote) are rewritten with it.
 *  CityStatus' Weather and Worker Pulse rows and the heat box (HeatAdvisoryWidget) follow too, redoing computeHeatTier with the newer
 *  temperature.
 *  A failed request, an empty answer or a page without these elements changes nothing. Lives here, not inline, so a test can run it
 *  in a real browser (live-weather.test.ts). All text is set with textContent. */
import { computeHeatTier, heatTierLine } from './heat-advisory';
import { forecastLine, signWeather, signWeatherText, statusWeatherText, type FPeriod } from './weather-format';
import { viewFor, weatherRegionHtml, type WeatherConfig } from './weather-html';
import type { WxPoint } from './weather-model';

export interface WeatherAnswer {
  periods?: FPeriod[];
  hourly?: FPeriod[];
  fetched_at?: string | null;
}

const t = (el: Element | null, text: string): void => { if (el) el.textContent = text; };
const alertsOf = (el: HTMLElement): string[] => {
  try { const v = JSON.parse(el.dataset.heatAlerts || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const TONE = { safe: 'quiet', caution: 'notice', 'high-risk': 'alert' } as const;

/** Heat box + Worker Pulse row. Only a Fahrenheit reading is used (the thresholds are °F); anything else leaves the built tier alone. */
function applyHeat(doc: Document, tempF: number | null): void {
  if (tempF === null) return;
  doc.querySelectorAll<HTMLElement>('[data-heat-advisory]').forEach((box) => {
    const { tier, label } = computeHeatTier(tempF, alertsOf(box));
    box.classList.remove('heat-advisory--safe', 'heat-advisory--caution', 'heat-advisory--high-risk');
    box.classList.add(`heat-advisory--${tier}`);
    // "Safe" is never shown: the box empties and hides instead.
    t(box.querySelector('[data-heat-tier]'), tier === 'safe' ? '' : heatTierLine(tier));
    t(box.querySelector('[data-heat-label]'), tier === 'safe' ? '' : label);
    box.hidden = tier === 'safe';
  });
  doc.querySelectorAll<HTMLElement>('[data-status-module="worker_pulse"]').forEach((row) => {
    const { tier, label } = computeHeatTier(tempF, alertsOf(row));
    t(row.querySelector('.city-status__value'), label);
    const dot = row.querySelector('.city-status__dot');
    if (dot) {
      dot.classList.remove('city-status__dot--quiet', 'city-status__dot--notice', 'city-status__dot--alert');
      dot.classList.add(`city-status__dot--${TONE[tier]}`);
    }
  });
}

export function applyWeather(doc: Document, w: WeatherAnswer, tz: string, country: string, now: Date): void {
  const periods = w.periods ?? [];
  if (periods.length === 0) return;

  const sign = signWeather(periods);
  const signEl = doc.querySelector('[data-weather-sign]');
  if (sign && signEl) signEl.textContent = signWeatherText(sign);
  if (sign) {
    t(doc.querySelector('[data-status-module="weather"] .city-status__value'), statusWeatherText(sign));
    applyHeat(doc, sign.unit === 'F' ? sign.temp : null);
  }

  const todayEl = doc.querySelector<HTMLElement>('[data-weather-today]');
  const line = forecastLine(periods, tz, now);
  if (todayEl && line) { todayEl.textContent = line; todayEl.hidden = false; }

  const regionEl = doc.querySelector<HTMLElement>('[data-weather-region]');
  if (regionEl) redrawRegion(doc, regionEl, w, now);
}

/** Redraw the answer block of /weather/ from the newer forecast. The config (unit, coordinates, zone) was embedded by the page. Open day
 *  rows stay open; an answer that gives the same markup as the one on the page changes nothing. */
function redrawRegion(doc: Document, region: HTMLElement, w: WeatherAnswer, now: Date): void {
  let cfg: WeatherConfig;
  try { cfg = JSON.parse(doc.querySelector('[data-weather-config]')?.textContent || ''); } catch { return; }
  if (!cfg || !cfg.tz) return;
  const view = viewFor({ periods: (w.periods ?? []) as WxPoint[], hourly: (w.hourly ?? []) as WxPoint[], fetchedAt: w.fetched_at ?? null }, cfg, now);
  const html = weatherRegionHtml(view);
  if (!html || region.dataset.markup === html) return;
  const open = [...region.querySelectorAll('details')].map((d) => d.open);
  region.innerHTML = html;
  region.dataset.markup = html;
  region.dataset.fetchedAt = view.fetchedAt ?? '';
  region.querySelectorAll('details').forEach((d, i) => { d.open = !!open[i]; });
  if (view.updated) {
    t(doc.querySelector('[data-wx-updated]'), view.updated);
    doc.querySelector('[data-wx-updated-wrap]')?.removeAttribute('hidden'); // the page was built from a payload without fetched_at
  }
}

export async function refreshLiveWeather(doc: Document, fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<void> {
  if (!doc.querySelector('[data-weather-sign], [data-weather-region], [data-weather-today], [data-status-module="weather"], [data-status-module="worker_pulse"], [data-heat-advisory]')) return;
  const tz = doc.documentElement.dataset.timezone || 'America/Chicago';
  const country = doc.documentElement.lang === 'en-GB' ? 'gb' : 'us';
  let body: WeatherAnswer;
  try {
    const res = await fetcher('/api/weather', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    body = await res.json();
  } catch {
    return;
  }
  applyWeather(doc, body, tz, country, now);
}
