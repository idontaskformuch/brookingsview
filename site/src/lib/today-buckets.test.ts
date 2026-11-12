import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { templateItems } from './today-buckets';

// Models Chromium: a template's DocumentFragment has `children`, but
// querySelectorAll(':scope > li') on it matches nothing.
function chromiumLikeFragment(items: object[]) {
  return { content: { children: items, querySelectorAll: () => [] } };
}

describe('templateItems', () => {
  it('finds the <li> children even though :scope > li matches nothing on a fragment', () => {
    const frag = chromiumLikeFragment([{ tagName: 'LI' }, { tagName: 'LI' }, { tagName: 'SCRIPT' }]);
    expect(templateItems(frag as never)).toHaveLength(2);
  });
});

// The real thing: the shipped code, bundled, run against a real <template> in
// a real browser. Skipped (loudly) where no Chromium is installed.
async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}
const browser = await launch();
// In CI a missing browser is a broken workflow, not a reason to skip.
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for today-buckets.test.ts (workflow must run `playwright-core install chromium`)');

// 30 s per test: the first page.setContent on a cold CI Chromium exceeds vitest's 5 s default.
describe.skipIf(!browser)('fillTodayBuckets in a real browser', { timeout: 30_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./today-buckets.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'TB', write: false,
  }).outputFiles[0].text;
  const TZ = 'America/Denver';
  // `tonightFromServer`: the bucket as pages/today.astro writes it for a town with SiteConfig.todayPage (visible, already filled).
  const html = (items: string, tonightFromServer = '') => `<!doctype html><body>
    <div id="today-tonight"${tonightFromServer ? '' : ' hidden'}><p>Tonight</p><div data-bucket-body>${tonightFromServer}</div></div>
    <div id="today-tomorrow" hidden><p>Tomorrow</p><div data-bucket-body></div></div>
    <div id="today-later" hidden><p>Coming up</p><div data-bucket-body></div></div>
    <template id="today-event-items" data-tz="${TZ}">${items}</template></body>`;

  async function run(items: string, now: string, tonightFromServer = '') {
    const page = await browser!.newPage();
    await page.setContent(html(items, tonightFromServer));
    await page.addScriptTag({ content: bundle });
    const out = await page.evaluate((n) => {
      const shown = (window as any).TB.fillTodayBuckets(document, new Date(n));
      const q = (s: string) => document.querySelector(s) as HTMLElement;
      return {
        shown,
        tonightHidden: q('#today-tonight').hidden, tomorrowHidden: q('#today-tomorrow').hidden,
        laterHidden: q('#today-later').hidden, laterItems: q('#today-later').querySelectorAll('li').length,
        tonightItems: q('#today-tonight').querySelectorAll('li').length,
        tomorrowItems: q('#today-tomorrow').querySelectorAll('li').length,
      };
    }, now);
    await page.close();
    return out;
  }

  // 2026-10-21 20:00Z = 14:00 Denver (Wed). Tonight needs local start >= 17:00.
  const NOW = '2026-10-21T20:00:00Z';
  it('fills Tonight and Tomorrow from a template with events', async () => {
    const r = await run(
      '<li data-start="2026-10-22T01:00:00Z"><a href="/a/">tonight 7pm</a></li>' +
      '<li data-start="2026-10-22T18:00:00Z"><a href="/b/">tomorrow noon</a></li>' +
      '<li data-start="2026-10-22T23:00:00Z"><a href="/c/">tomorrow 5pm</a></li>', NOW);
    expect(r).toMatchObject({ shown: 3, tonightHidden: false, tomorrowHidden: false, laterHidden: true, tonightItems: 1, tomorrowItems: 2 });
  });
  it('hides an empty bucket and shows only the populated one', async () => {
    const r = await run('<li data-start="2026-10-22T18:00:00Z"><a href="/b/">tomorrow noon</a></li>', NOW);
    expect(r).toMatchObject({ tonightHidden: true, tomorrowHidden: false, laterHidden: true });
  });
  it('shows no message when there are no events at all, and no Coming up list either', async () => {
    const r = await run('', NOW);
    expect(r).toMatchObject({ shown: 0, tonightHidden: true, tomorrowHidden: true, laterHidden: true, laterItems: 0 });
  });
  it('with nothing today or tomorrow, lists the nearest upcoming events (soonest first, ended ones left out)', async () => {
    const r = await run(
      '<li data-start="2026-10-25T01:00:00Z"><a href="/late/">sat</a></li>' +
      '<li data-start="2026-10-24T01:00:00Z"><a href="/soon/">fri</a></li>' +
      '<li data-start="2026-10-21T15:00:00Z" data-end="2026-10-21T16:00:00Z"><a href="/over/">ended</a></li>', NOW);
    expect(r).toMatchObject({ shown: 0, laterHidden: false, laterItems: 2 });
  });
  it('does not show Coming up when there is something today or tomorrow', async () => {
    const r = await run('<li data-start="2026-10-22T18:00:00Z"><a href="/b/">tomorrow</a></li><li data-start="2026-10-26T18:00:00Z"><a href="/x/">next week</a></li>', NOW);
    expect(r).toMatchObject({ shown: 1, laterHidden: true });
  });
  it('hides a Tonight bucket the server filled once its events are over (todayPage, 2026-11-12)', async () => {
    const li = '<li data-start="2026-10-22T01:00:00Z" data-end="2026-10-22T03:00:00Z"><a href="/a/">tonight 7-9pm</a></li>';
    // 23:30 Denver: the 7-9 PM event the 4 PM build wrote under Tonight has ended
    const r = await run(li, '2026-10-22T05:30:00Z', `<ul>${li}</ul>`);
    expect(r).toMatchObject({ tonightHidden: true, tonightItems: 0 });
  });
});
