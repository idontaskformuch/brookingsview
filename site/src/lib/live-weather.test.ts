import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { currentPeriods, relabelPeriod, signWeather, signWeatherText, upcomingHours, hourLabel } from './weather-format';

// Pure helpers (shared by the build and the browser)
const NOW = new Date('2026-10-28T18:30:00Z'); // 13:30 in Chicago
const p = (start: string, temp: number, day: boolean, over: object = {}) => ({ name: 'x', start, temp, unit: 'F', short: 'Mostly Cloudy', wind: '10 mph', is_daytime: day, ...over });

describe('weather-format', () => {
  it('sign text: first daytime period, "High 54°F mostly cloudy"', () => {
    const w = signWeather([p('2026-10-28T23:00:00Z', 40, false), p('2026-10-29T12:00:00Z', 54.4, true)])!;
    expect(signWeatherText(w)).toBe('High 54°F mostly cloudy');
  });
  it('sign: no temperature -> nothing to show', () => {
    expect(signWeather([])).toBeNull();
    expect(signWeather([p('2026-10-28T12:00:00Z', null as any, true)])).toBeNull();
  });
  it('relabels periods from the reader\'s today, not the source\'s own names', () => {
    expect(relabelPeriod(p('2026-10-28T12:00:00Z', 50, true), 'America/Chicago', NOW)).toBe('Today');
    expect(relabelPeriod(p('2026-10-29T03:00:00Z', 40, false), 'America/Chicago', NOW)).toBe('Tonight');
    expect(relabelPeriod(p('2026-10-29T15:00:00Z', 50, true), 'America/Chicago', NOW)).toBe('Tomorrow');
    expect(relabelPeriod(p('2026-10-31T15:00:00Z', 50, true), 'America/Chicago', NOW)).toBe('Saturday');
  });
  it('drops hours already over and periods from an earlier local day', () => {
    const hrs = [p('2026-10-28T16:00:00Z', 1, true), p('2026-10-28T18:00:00Z', 2, true), p('2026-10-28T19:00:00Z', 3, true)];
    expect(upcomingHours(hrs, NOW).map((h) => h.temp)).toEqual([2, 3]);
    expect(currentPeriods([p('2026-10-26T12:00:00Z', 1, true), p('2026-10-28T12:00:00Z', 2, true)], 'America/Chicago', NOW).map((x) => x.temp)).toEqual([2]);
  });
  it('hour labels: US "1 PM", UK "1pm"', () => {
    expect(hourLabel('2026-10-28T18:00:00Z', 'America/Chicago', 'us')).toBe('1 PM');
    expect(hourLabel('2026-10-28T13:00:00Z', 'Europe/London', 'gb')).toBe('1pm');
  });
});

// The shipped module, bundled and run against real markup in a real browser (skipped where no Chromium is installed).
async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}
const browser = await launch();
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for live-weather.test.ts');

describe.skipIf(!browser)('live weather in a real browser', { timeout: 30_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./live-weather.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'LW', write: false,
  }).outputFiles[0].text;
  const config = { unit: 'F', lat: 41.88, lon: -87.63, tz: 'America/Chicago', country: 'us', yesterday: null };
  const html = `<span data-weather-sign>High&nbsp;40&deg;F&nbsp;old</span><span data-wx-updated>old</span>
    <div data-weather-region><p class="ui-hero__label">old</p><details open><summary>kept open?</summary></details></div>
    <script type="application/json" data-weather-config>${JSON.stringify(config)}</script>`;
  const answer = {
    periods: [p('2026-10-28T23:00:00Z', 41, false), p('2026-10-29T15:00:00Z', 55, true, { short: 'Sunny' })],
    hourly: [p('2026-10-28T15:00:00Z', 9, true), p('2026-10-28T18:00:00Z', 43, true), p('2026-10-28T19:00:00Z', 44, true), p('2026-10-28T20:00:00Z', 45, true)],
    fetched_at: '2026-10-28T18:05:00Z',
  };

  async function run(respond: 'ok' | '500' | 'offline' | 'empty', page_html = html) {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><html lang="en" data-timezone="America/Chicago"><body>${page_html}</body></html>`);
    await page.addScriptTag({ content: bundle });
    const out = await page.evaluate(async ([r, ans, nowIso]) => {
      let calls = 0;
      const fetcher = (async () => {
        calls++;
        if (r === 'offline') throw new Error('offline');
        if (r === '500') return new Response('', { status: 500 });
        return new Response(JSON.stringify(r === 'empty' ? { periods: [], hourly: [] } : ans));
      }) as typeof fetch;
      await (window as any).LW.refreshLiveWeather(document, fetcher, new Date(nowIso));
      const q = (s: string) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent);
      return {
        calls, sign: document.querySelector('[data-weather-sign]')?.textContent ?? null,
        label: q('.ui-hero__label'), hero: q('.ui-hero__value > span:first-child'), hours: q('.ui-hr__time'), hourTemps: q('.ui-hr__temp'),
        days: q('.ui-wd__name'), current: q('.ui-hr.is-current .ui-hr__time'), updated: q('[data-wx-updated]'), fetched: (document.querySelector('[data-weather-region]') as HTMLElement | null)?.dataset.fetchedAt ?? null,
      };
    }, [respond, answer, NOW.toISOString()] as const);
    await page.close();
    return out;
  }

  it('rewrites the sign strip and the whole answer block (hero for this hour, hourly strip, day rows) from the answer', async () => {
    const r = await run('ok');
    expect(r.sign).toBe('High 55°F sunny');
    expect(r.label).toEqual(['Forecast for 1 PM']);   // 13:30 in Chicago: the 18:00Z point covers now
    expect(r.hero).toEqual(['43°']);
    expect(r.hours).toEqual(['1 PM', '2 PM', '3 PM']);
    expect(r.current).toEqual(['1 PM']);
    expect(r.hourTemps).toEqual(['43°', '44°', '45°']);
    expect(r.days).toEqual(['Tonight', 'Thu']);
    expect(r.updated).toEqual(['1:05 PM']);
    expect(r.fetched).toBe('2026-10-28T18:05:00Z');
  });
  it('a failed request, an offline browser or an empty answer leaves the built forecast alone', async () => {
    for (const r of ['500', 'offline', 'empty'] as const) {
      const out = await run(r);
      expect(out.sign, r).toBe('High 40°F old');
      expect(out.label, r).toEqual(['old']);
      expect(out.hours, r).toEqual([]);
    }
  });
  // Round 4 (2026-11-02): CityStatus' Weather/Worker Pulse rows and the heat box followed only the build's forecast.
  const statusHtml = `<section class="city-status"><ul>
    <li data-status-module="weather"><a class="city-status__link"><span class="city-status__dot city-status__dot--quiet"></span><span class="city-status__value">High 40°F, Old</span></a></li>
    <li data-status-module="worker_pulse" data-heat-alerts="[]"><a class="city-status__link"><span class="city-status__dot city-status__dot--quiet"></span><span class="city-status__value">80°F – safe conditions</span></a></li>
    </ul></section>
    <div class="heat-advisory heat-advisory--safe" hidden data-heat-advisory data-heat-alerts="[]"><div class="heat-advisory__tier" data-heat-tier></div><div class="heat-advisory__label" data-heat-label></div></div>`;
  async function runStatus(dayTemp: number, unit = 'F', alerts = '[]') {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><html lang="en" data-timezone="America/Chicago"><body>${statusHtml.replaceAll('data-heat-alerts="[]"', `data-heat-alerts='${alerts}'`)}</body></html>`);
    await page.addScriptTag({ content: bundle });
    const out = await page.evaluate(async ([ans, nowIso]) => {
      const fetcher = (async () => new Response(JSON.stringify(ans))) as typeof fetch;
      await (window as any).LW.refreshLiveWeather(document, fetcher, new Date(nowIso));
      const box = document.querySelector<HTMLElement>('[data-heat-advisory]')!;
      const pulse = document.querySelector('[data-status-module="worker_pulse"]')!;
      return {
        weather: document.querySelector('[data-status-module="weather"] .city-status__value')?.textContent,
        pulse: pulse.querySelector('.city-status__value')?.textContent,
        pulseDot: pulse.querySelector('.city-status__dot')?.className,
        boxHidden: box.hidden, boxClass: box.className,
        boxTier: box.querySelector('[data-heat-tier]')?.textContent, boxLabel: box.querySelector('[data-heat-label]')?.textContent,
      };
    }, [{ periods: [p('2026-10-28T23:00:00Z', 70, false, { unit }), p('2026-10-29T15:00:00Z', dayTemp, true, { short: 'Sunny', unit })] }, NOW.toISOString()] as const);
    await page.close();
    return out;
  }
  it('Right now: the Weather row follows /api/weather', async () => {
    const r = await runStatus(55);
    expect(r.weather).toBe('High 55°F, Sunny');
  });
  it('heat: a newer 96°F forecast reveals the caution box and turns Worker Pulse to notice', async () => {
    const r = await runStatus(96);
    expect(r.boxHidden).toBe(false);
    expect(r.boxClass).toContain('heat-advisory--caution');
    expect(r.boxTier).toBe('Caution for outdoor & loading-dock work');
    expect(r.boxLabel).toBe('96°F – use caution outdoors');
    expect(r.pulse).toBe('96°F – use caution outdoors');
    expect(r.pulseDot).toContain('city-status__dot--notice');
  });
  it('heat: an active heat warning still wins over a mild newer forecast; a safe tier stays hidden and empty', async () => {
    const warned = await runStatus(80, 'F', '["Excessive Heat Warning"]');
    expect(warned.boxClass).toContain('heat-advisory--high-risk');
    expect(warned.boxLabel).toBe('Excessive Heat Warning');
    const safe = await runStatus(70);
    expect(safe.boxHidden).toBe(true);
    expect(safe.boxTier).toBe('');
    expect(safe.pulseDot).toContain('city-status__dot--quiet');
  });
  it('heat: a Celsius answer never feeds the °F thresholds', async () => {
    const r = await runStatus(36, 'C');
    expect(r.boxHidden).toBe(true);
    expect(r.pulse).toBe('80°F – safe conditions');
  });
  it('a page with none of the elements makes no request at all', async () => {
    const out = await run('ok', '<p>no forecast here</p>');
    expect(out.calls).toBe(0);
  });
});
