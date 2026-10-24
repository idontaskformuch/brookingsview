import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';

// The shipped sweep, bundled and run against real markup in a real browser.
// Skipped where no Chromium is installed (a missing browser in CI is a broken workflow).
async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}
const browser = await launch();
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for hide-ended.test.ts (workflow must run `playwright-core install chromium`)');

describe.skipIf(!browser)('sweepEnded in a real browser', { timeout: 30_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./hide-ended.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'HE', write: false,
  }).outputFiles[0].text;
  const TZ = 'Europe/London';

  async function run(body: string, now: string) {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><style>.sec{display:flex}</style><body>${body}</body>`);
    await page.addScriptTag({ content: bundle });
    const out = await page.evaluate(([n, tz]) => {
      (window as any).HE.sweepEnded(document, new Date(n), tz);
      const vis = (s: string) => {
        const el = document.querySelector(s) as HTMLElement | null;
        return !!el && getComputedStyle(el).display !== 'none' && !el.hidden;
      };
      return {
        todayHeading: vis('#today-head'), todayList: vis('#today-list'), laterHeading: vis('#later-head'),
        status: (document.querySelector('[data-event-status]') as HTMLElement | null)?.textContent ?? null,
        statusShown: vis('[data-event-status]'),
      };
    }, [now, TZ] as const);
    await page.close();
    return out;
  }

  // Max Richter, Fri 23 Oct 2026 19:30 BST (18:30Z), no end -> over 22:30 BST.
  const todayList = `<div class="sec" id="today-head"><h2>Today</h2></div>
    <div class="grid" id="today-list" data-hide-ended data-hide-heading><article data-start="2026-10-23T18:30:00.000Z"><a href="/s/x/">SCO: Max Richter</a></article></div>
    <div class="sec" id="later-head"><h2>Coming up</h2></div>
    <div class="grid" data-hide-ended data-hide-heading><article data-start="2026-10-27T13:30:00.000Z"><a href="/s/y/">Tour</a></article></div>`;

  it('keeps Today (heading and card) while the event is still on', async () => {
    const r = await run(todayList, '2026-10-23T19:00:00Z');
    expect(r).toMatchObject({ todayHeading: true, todayList: true, laterHeading: true });
  });

  it('drops the card AND its heading once everything in Today has finished', async () => {
    const r = await run(todayList, '2026-10-23T22:45:00Z');
    expect(r).toMatchObject({ todayList: true /* the grid itself stays, only its cards are hidden */, todayHeading: false, laterHeading: true });
  });

  it('keeps the heading when the list is not marked data-hide-heading (e.g. Today with a home game note)', async () => {
    const r = await run(todayList.replace('data-hide-ended data-hide-heading><article data-start="2026-10-23', 'data-hide-ended><article data-start="2026-10-23'), '2026-10-23T22:45:00Z');
    expect(r.todayHeading).toBe(true);
  });

  // University digest (/s/university-digest-*): theme groups of rows; passed rows go, a group with none left goes too.
  const digest = `<section id="g1"><h2>Music</h2><ul data-hide-ended data-hide-section>
      <li data-start="2026-10-23T18:30:00.000Z">Fri 7:30pm Recital</li></ul></section>
    <section id="g2"><h2>Sports</h2><ul data-hide-ended data-hide-section>
      <li data-start="2026-10-23T18:30:00.000Z">Fri 7:30pm Volleyball</li><li data-start="2026-10-24T18:00:00.000Z">Sat 7pm Football</li></ul></section>`;
  it('university digest: drops passed rows and a theme group that has none left', async () => {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><body>${digest}</body>`);
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(() => {
      (window as any).HE.sweepEnded(document, new Date('2026-10-24T09:00:00Z'), 'Europe/London');
      const shown = (s: string) => getComputedStyle(document.querySelector(s)!).display !== 'none';
      return { g1: shown('#g1'), g2: shown('#g2'), rows: [...document.querySelectorAll('#g2 li')].filter((l) => !(l as HTMLElement).hidden).length };
    });
    await page.close();
    expect(r).toEqual({ g1: false, g2: true, rows: 1 });
  });

  const status = '<p data-event-status hidden data-start="2026-10-23T18:30:00.000Z" data-end="" data-tz="Europe/London"></p>';
  it('event page: unchanged before the start, "on now" after it starts, "passed" after it ends', async () => {
    expect(await run(status, '2026-10-23T17:00:00Z')).toMatchObject({ statusShown: false, status: '' });
    expect(await run(status, '2026-10-23T19:00:00Z')).toMatchObject({ statusShown: true, status: 'This event is on now.' });
    expect(await run(status, '2026-10-23T22:00:00Z')).toMatchObject({ statusShown: true, status: 'This event has passed.' });
  });
});
