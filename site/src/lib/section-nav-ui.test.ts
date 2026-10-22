import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import SectionNav from '../components/SectionNav.astro';
import { resolveNav, type ResolvedNav } from './nav-sections';
import { ALL_CONFIGS } from './site-config';

// Runs the REAL component markup (rendered by Astro) and the REAL behaviour code
// (bundled from section-nav-ui.ts) in a real browser, once per town with that town's REAL
// nav config. Skipped when no browser exists. Colour contrast (axe, light + dark) needs
// the site's CSS variables and is covered on the real pages by QA Pass B, not here.
const NAVS = ALL_CONFIGS.map((c) => ({ town: c.townId, nav: resolveNav(c.nav, c) }));
const here = (f: string) => new URL(f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CSS = /<style is:global>([\s\S]*?)<\/style>/.exec(readFileSync(here('../components/SectionNav.astro'), 'utf8'))![1];

let browser: Browser | null = null;
let bundle = '';
const htmlOf = new Map<string, string>();

async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}

// Real-browser tests: the first page open on a cold CI runner exceeds vitest's 5 s default.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  const container = await AstroContainer.create();
  for (const { town, nav } of NAVS) htmlOf.set(town, await container.renderToString(SectionNav, { props: { nav, path: '/city-hall/' } }));
  bundle = buildSync({ entryPoints: [here('./section-nav-ui.ts')], bundle: true, format: 'iife', globalName: 'SNAV', write: false }).outputFiles[0].text;
  browser = await launch();
}, 90_000); // renders 3 towns' nav + bundles + launches a browser: > the 10 s default on a loaded CI runner
afterAll(async () => { await browser?.close(); }, 30_000);

async function open(town: string): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 360, height: 740 } });
  const doc = `<!doctype html><html><head><style>${CSS}</style></head><body>${htmlOf.get(town)}</body></html>`;
  await page.route('http://qa.test/**', (r) => r.fulfill({ contentType: 'text/html', body: doc }));
  await page.goto('http://qa.test/city-hall/');
  await page.evaluate(() => { (window as any).__ev = []; (window as any).gtag = (...a: unknown[]) => (window as any).__ev.push(a); });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as any).SNAV.initSectionNav(document.querySelector('[data-snav]')));
  return page;
}
const state = (page: Page) => page.evaluate(() => ({
  hidden: (document.querySelector('[data-snav-layer]') as HTMLElement).hidden,
  expanded: document.querySelector('[data-snav-open]')!.getAttribute('aria-expanded'),
  focusOnAll: document.activeElement?.hasAttribute('data-snav-open') ?? false,
  focusInSheet: !!document.activeElement?.closest('[data-snav-sheet]'),
  lock: document.documentElement.classList.contains('snav-lock'),
  path: location.pathname,
}));

describe.each(NAVS)('SectionNav $town', ({ town, nav }: { town: string; nav: ResolvedNav }) => {
  const html = () => htmlOf.get(town)!;
  const count = (s: string) => (s.match(/<a /g) ?? []).length;

  it('lists every section as a plain link inside a <details>, so it works without JavaScript', () => {
    const groups = html().slice(html().indexOf('data-snav-groups'), html().indexOf('data-snav-open'));
    expect(count(groups)).toBe(nav.groups.reduce((n, g) => n + g.items.length, 0));
    expect(html()).toContain('<details class="snav__fallback"');
    expect(html()).toContain('aria-haspopup="dialog"');
    expect(html()).toContain('aria-current="page"');
  });
  it('the swipe row has exactly the configured tabs and nothing else', () => {
    const row = html().slice(html().indexOf('data-snav-row'), html().indexOf('data-snav-fallback'));
    expect(count(row)).toBe(nav.tabs.length);
  });
  it('at 360 px: one row, no page sideways scroll, All visible and fully inside the viewport', async () => {
    if (!browser) return;
    const page = await open(town);
    const m = await page.evaluate(() => {
      const row = document.querySelector('[data-snav-row]') as HTMLElement;
      const tops = new Set([...row.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top)));
      const all = document.querySelector('[data-snav-open]') as HTMLElement;
      const r = all.getBoundingClientRect();
      return {
        rowTops: tops.size,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        allVisible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth && getComputedStyle(all).visibility !== 'hidden',
      };
    });
    expect(m).toEqual({ rowTops: 1, pageOverflow: 0, allVisible: true });
    await page.close();
  });
  it('opens as a dialog: aria-expanded, focus into the sheet, body locked, history entry pushed', async () => {
    if (!browser) return;
    const page = await open(town);
    await page.click('[data-snav-open]');
    expect(await state(page)).toMatchObject({ hidden: false, expanded: 'true', focusInSheet: true, lock: true });
    expect(await page.evaluate(() => history.state)).toEqual({ snav: 1 });
    expect(await page.getAttribute('[data-snav-sheet]', 'role')).toBe('dialog');
    await page.close();
  });
  for (const [name, close] of [
    ['Escape', (p: Page) => p.keyboard.press('Escape')],
    ['the close button', (p: Page) => p.click('[data-snav-close-btn]')],
    ['a tap on the scrim', (p: Page) => p.dispatchEvent('[data-snav-scrim]', 'click')],
    ['the browser back button', (p: Page) => p.goBack()],
  ] as const) {
    it(`closes on ${name} and returns focus to All`, async () => {
      if (!browser) return;
      const page = await open(town);
      await page.click('[data-snav-open]');
      await close(page);
      await page.waitForTimeout(200);
      expect(await state(page)).toMatchObject({ hidden: true, expanded: 'false', focusOnAll: true, lock: false, path: '/city-hall/' });
      await page.close();
    });
  }
  it('traps focus while open', async () => {
    if (!browser) return;
    const page = await open(town);
    await page.click('[data-snav-open]');
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      expect((await state(page)).focusInSheet).toBe(true);
    }
    await page.close();
  });
  it('selecting a section closes the sheet and navigates', async () => {
    if (!browser) return;
    const page = await open(town);
    await page.click('[data-snav-open]');
    // any section other than the page we are on (/city-hall/); not every town has /weather/ (Glasgow skeleton)
    const target = nav.groups.flatMap((g) => g.items.map((i) => i.href)).find((h) => h !== '/city-hall/')!;
    await page.click(`[data-snav-sheet] a[href="${target}"]`);
    await page.waitForURL(`**${target}`);
    expect(new URL(page.url()).pathname).toBe(target);
    await page.close();
  });
  it('reports tab taps and sheet opens through gtag', async () => {
    if (!browser) return;
    const page = await open(town);
    const tab = nav.tabs[1].id;
    await page.click('[data-snav-open]');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('[data-snav-row] a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
    await page.click(`[data-snav-row] a[data-nav-id="${tab}"]`);
    const ev = await page.evaluate(() => (window as any).__ev as unknown[][]);
    expect(ev).toContainEqual(['event', 'nav_all_open', {}]);
    expect(ev).toContainEqual(['event', 'nav_tab_click', { section: tab, placement: 'tab' }]);
    await page.close();
  });
});
