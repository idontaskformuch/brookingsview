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
  const html = `<span data-weather-sign>High&nbsp;40&deg;F&nbsp;old</span>
    <div data-weather-hourly><div class="hour" data-astro-cid-x><p class="hour__time">old</p><p class="hour__temp">0</p><p class="hour__short">old</p></div></div>
    <ul data-weather-forecast><li class="forecast__row" data-astro-cid-x><span class="forecast__name">old</span><span class="forecast__temp"></span><span class="forecast__short"></span><span class="forecast__wind"></span></li></ul>`;
  const answer = {
    periods: [p('2026-10-28T23:00:00Z', 41, false), p('2026-10-29T15:00:00Z', 55, true, { short: 'Sunny' })],
    hourly: [p('2026-10-28T15:00:00Z', 9, true), p('2026-10-28T19:00:00Z', 44, true), p('2026-10-28T20:00:00Z', 45, true)],
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
        hours: q('.hour__time'), hourTemps: q('.hour__temp'), names: q('.forecast__name'), temps: q('.forecast__temp'),
        cid: document.querySelectorAll('.hour[data-astro-cid-x]').length,
      };
    }, [respond, answer, NOW.toISOString()] as const);
    await page.close();
    return out;
  }

  it('rewrites the sign strip, the hourly strip and the day list from the answer', async () => {
    const r = await run('ok');
    expect(r.sign).toBe('High 55°F sunny');
    expect(r.hours).toEqual(['2 PM', '3 PM']);
    expect(r.hourTemps).toEqual(['44°F', '45°F']);
    expect(r.names).toEqual(['Tonight', 'Tomorrow']);
    expect(r.temps).toEqual(['41°F', '55°F']);
    expect(r.cid).toBe(2); // clones keep the page's scoped-style attribute
  });
  it('a failed request, an offline browser or an empty answer leaves the built forecast alone', async () => {
    for (const r of ['500', 'offline', 'empty'] as const) {
      const out = await run(r);
      expect(out.sign, r).toBe('High 40°F old');
      expect(out.hours, r).toEqual(['old']);
    }
  });
  it('a page with none of the elements makes no request at all', async () => {
    const out = await run('ok', '<p>no forecast here</p>');
    expect(out.calls).toBe(0);
  });
});
