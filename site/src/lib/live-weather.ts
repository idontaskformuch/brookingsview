/** Browser side of /api/weather (server/weather.ts). The forecast built into the page is the fallback; the cron-dispatcher Worker writes a
 *  fresh one every hour. When the API answers, the sign strip and (on /weather/) the hourly strip and the day list are rewritten with it.
 *  CityStatus' Weather and Worker Pulse rows and the heat box (HeatAdvisoryWidget) follow too, redoing computeHeatTier with the newer
 *  temperature.
 *  A failed request, an empty answer or a page without these elements changes nothing. Lives here, not inline, so a test can run it
 *  in a real browser (live-weather.test.ts). All text is set with textContent. */
import { computeHeatTier, heatTierLine } from './heat-advisory';
import { currentPeriods, forecastLine, hourLabel, relabelPeriod, signWeather, signWeatherText, statusWeatherText, upcomingHours, type FPeriod } from './weather-format';

export interface WeatherAnswer {
  periods?: FPeriod[];
  hourly?: FPeriod[];
}

const t = (el: Element | null, text: string): void => { if (el) el.textContent = text; };
const temp = (p: FPeriod): string => `${p.temp !== null && p.temp !== undefined ? Math.round(p.temp) : '—'}°${p.unit ?? ''}`;

/** Clone the first server-rendered node (it carries the page's scoped-style attribute), then fill it. */
function rebuild<T extends FPeriod>(list: Element, items: T[], fill: (node: HTMLElement, item: T) => void): void {
  const proto = list.firstElementChild as HTMLElement | null;
  if (!proto || items.length === 0) return;
  const nodes = items.map((item) => {
    const node = proto.cloneNode(true) as HTMLElement;
    fill(node, item);
    return node;
  });
  list.replaceChildren(...nodes);
}

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

  const hourlyEl = doc.querySelector('[data-weather-hourly]');
  const hours = upcomingHours(w.hourly ?? [], now);
  if (hourlyEl) {
    rebuild(hourlyEl, hours, (node, h) => {
      t(node.querySelector('.hour__time'), hourLabel(h.start as string, tz, country));
      t(node.querySelector('.hour__temp'), temp(h));
      t(node.querySelector('.hour__short'), h.short ?? '');
    });
  }

  const listEl = doc.querySelector('[data-weather-forecast]');
  if (listEl) {
    rebuild(listEl, currentPeriods(periods, tz, now), (node, p) => {
      t(node.querySelector('.forecast__name'), relabelPeriod(p, tz, now));
      t(node.querySelector('.forecast__temp'), temp(p));
      t(node.querySelector('.forecast__short'), p.short ?? '');
      t(node.querySelector('.forecast__wind'), p.wind ?? '');
    });
  }
}

export async function refreshLiveWeather(doc: Document, fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<void> {
  if (!doc.querySelector('[data-weather-sign], [data-weather-hourly], [data-weather-forecast], [data-weather-today], [data-status-module="weather"], [data-status-module="worker_pulse"], [data-heat-advisory]')) return;
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
