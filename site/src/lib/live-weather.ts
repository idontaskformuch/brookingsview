/** Browser side of /api/weather (server/weather.ts). The forecast built into the page is the fallback; the cron-dispatcher Worker writes a
 *  fresh one every hour. When the API answers, the sign strip and (on /weather/) the hourly strip and the day list are rewritten with it.
 *  A failed request, an empty answer or a page without these elements changes nothing. Lives here, not inline, so a test can run it
 *  in a real browser (live-weather.test.ts). All text is set with textContent. */
import { currentPeriods, forecastLine, hourLabel, relabelPeriod, signWeather, signWeatherText, upcomingHours, type FPeriod } from './weather-format';

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

export function applyWeather(doc: Document, w: WeatherAnswer, tz: string, country: string, now: Date): void {
  const periods = w.periods ?? [];
  if (periods.length === 0) return;

  const sign = signWeather(periods);
  const signEl = doc.querySelector('[data-weather-sign]');
  if (sign && signEl) signEl.textContent = signWeatherText(sign);

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
  if (!doc.querySelector('[data-weather-sign], [data-weather-hourly], [data-weather-forecast], [data-weather-today]')) return;
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
