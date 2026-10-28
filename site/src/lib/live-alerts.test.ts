import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { eventIdFromSlug, planAlertUpdate, type LiveAlert } from './live-alerts';

const alert = (id: number, over: Partial<LiveAlert> = {}): LiveAlert => ({
  id, source: 'nws_alert', event: 'Winter Storm Warning', headline: 'h', description: 'Heavy snow expected. Travel could be difficult.',
  endsAt: '2026-10-29T12:00:00.000Z', url: 'https://api.weather.gov/alerts/x', ...over,
});

describe('eventIdFromSlug', () => {
  it('reads the events id out of an alert story slug', () => {
    expect(eventIdFromSlug('alert-123')).toBe(123);
    expect(eventIdFromSlug('event-123')).toBeNull();
    expect(eventIdFromSlug(undefined)).toBeNull();
  });
});

describe('planAlertUpdate', () => {
  it('shows NWS alerts the page does not know, hides known ones that ended', () => {
    const plan = planAlertUpdate(new Set([1, 2]), [alert(2), alert(3), alert(4, { source: 'county_alert' })]);
    expect(plan.toShow.map((a) => a.id)).toEqual([3]);
    expect([...plan.toHide]).toEqual([1]);
  });
  it('an empty answer hides every known alert (all were cancelled)', () => {
    expect([...planAlertUpdate(new Set([1, 2]), []).toHide].sort()).toEqual([1, 2]);
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
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for live-alerts.test.ts');

describe.skipIf(!browser)('live alerts in a real browser', { timeout: 30_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./live-alerts.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'LA', write: false,
  }).outputFiles[0].text;
  const html = `<span id="a" data-alert-slug="alert-1">old</span><span id="b" data-alert-slug="alert-2">kept</span>
    <section id="live-alerts" data-tz="America/Chicago" data-known="1,2" hidden></section>`;

  async function run(respond: string) {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><body>${html}</body>`);
    await page.addScriptTag({ content: bundle });
    const out = await page.evaluate(async (r) => {
      const fetcher = (async () => {
        if (r === 'offline') throw new Error('offline');
        return new Response(r === '500' ? '' : r, { status: r === '500' ? 500 : 200 });
      }) as typeof fetch;
      await (window as any).LA.refreshLiveAlerts(document, fetcher);
      const bar = document.getElementById('live-alerts')!;
      return {
        aHidden: (document.getElementById('a') as HTMLElement).hidden, bHidden: (document.getElementById('b') as HTMLElement).hidden,
        barHidden: bar.hidden, barText: bar.textContent, barImgs: bar.querySelectorAll('img').length,
      };
    }, respond);
    await page.close();
    return out;
  }

  it('hides a cancelled alert and lists a new one with the official first sentence and the source', async () => {
    const r = await run(JSON.stringify({ alerts: [alert(2), alert(3)] }));
    expect(r.aHidden).toBe(true);
    expect(r.bHidden).toBe(false);
    expect(r.barHidden).toBe(false);
    expect(r.barText).toContain('Winter Storm Warning');
    expect(r.barText).toContain('Heavy snow expected.');
    expect(r.barText).not.toContain('Travel could be difficult');
    expect(r.barText).toContain('Source: National Weather Service');
  });
  it('a failed request or an offline browser changes nothing', async () => {
    for (const r of ['500', 'offline']) {
      const out = await run(r);
      expect(out.aHidden).toBe(false);
      expect(out.barHidden).toBe(true);
    }
  });
  it('text from the API is set as text, never as markup', async () => {
    const r = await run(JSON.stringify({ alerts: [alert(9, { event: '<img src=x onerror=alert(1)>' })] }));
    expect(r.barImgs).toBe(0);
    expect(r.barText).toContain('<img');
  });
});
