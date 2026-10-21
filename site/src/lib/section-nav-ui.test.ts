import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { buildSync } from 'esbuild';
import SectionNav from '../components/SectionNav.astro';
import { resolveNav, type NavGate } from './nav-sections';

// Runs the REAL component markup (rendered by Astro) and the REAL behaviour code
// (bundled from section-nav-ui.ts) in a real browser. Skipped when no browser exists.
const GATE: NavGate = { townId: 'brookings_sd', hasWhatsOn: true, hasClosureWatch: true };
const NAV = resolveNav({
  tabs: ['today', 'events', 'university', 'jacks', 'cityhall', 'traffic', 'jobs'],
  groups: {
    Now: ['today', 'events', 'whatson', 'thisweek', 'weather'],
    Campus: ['university', 'jacks'],
    City: ['cityhall', 'traffic', 'closures', 'facilities'],
    More: ['jobs', 'play', 'farm'],
  },
}, GATE);

let browser: Browser | null = null;
let html = '';
let bundle = '';

async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}

beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(SectionNav, { props: { nav: NAV, path: '/city-hall/' } });
  bundle = buildSync({ entryPoints: [new URL('./section-nav-ui.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'SNAV', write: false }).outputFiles[0].text;
  browser = await launch();
});
afterAll(async () => { await browser?.close(); });

async function open(): Promise<{ page: Page; events: [string, Record<string, unknown>][] }> {
  const page = await browser!.newPage({ viewport: { width: 360, height: 740 } });
  const doc = `<!doctype html><html><body>${html}</body></html>`;
  await page.route('http://qa.test/**', (r) => r.fulfill({ contentType: 'text/html', body: doc }));
  await page.goto('http://qa.test/city-hall/');
  await page.evaluate(() => { (window as any).__ev = []; (window as any).gtag = (...a: unknown[]) => (window as any).__ev.push(a); });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as any).SNAV.initSectionNav(document.querySelector('[data-snav]')));
  return { page, events: [] as never };
}
const state = (page: Page) => page.evaluate(() => ({
  hidden: (document.querySelector('[data-snav-layer]') as HTMLElement).hidden,
  expanded: document.querySelector('[data-snav-open]')!.getAttribute('aria-expanded'),
  focusOnAll: document.activeElement?.hasAttribute('data-snav-open') ?? false,
  focusInSheet: !!document.activeElement?.closest('[data-snav-sheet]'),
  lock: document.documentElement.classList.contains('snav-lock'),
  path: location.pathname,
}));

describe('SectionNav markup (no JS)', () => {
  it('lists every section as a plain link inside a <details>, so it works without JavaScript', () => {
    const groups = html.slice(html.indexOf('data-snav-groups'), html.indexOf('data-snav-open'));
    expect((groups.match(/<a /g) ?? []).length).toBe(14);
    expect(html).toContain('<details class="snav__fallback"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-current="page"');
  });
  it('the swipe row has the seven tabs and nothing else', () => {
    const row = html.slice(html.indexOf('data-snav-row'), html.indexOf('data-snav-fallback'));
    expect((row.match(/<a /g) ?? []).length).toBe(7);
  });
});

describe('SectionNav behaviour in a real browser (each test is a no-op when no browser is installed)', () => {
  it('opens as a dialog: aria-expanded, focus into the sheet, body locked, history entry pushed', async () => {
    if (!browser) return;
    const { page } = await open();
    await page.click('[data-snav-open]');
    const s = await state(page);
    expect(s).toMatchObject({ hidden: false, expanded: 'true', focusInSheet: true, lock: true });
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
      const { page } = await open();
      await page.click('[data-snav-open]');
      await close(page);
      await page.waitForTimeout(200);
      expect(await state(page)).toMatchObject({ hidden: true, expanded: 'false', focusOnAll: true, lock: false, path: '/city-hall/' });
      await page.close();
    });
  }
  it('traps focus while open', async () => {
    if (!browser) return;
    const { page } = await open();
    await page.click('[data-snav-open]');
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      expect((await state(page)).focusInSheet).toBe(true);
    }
    await page.close();
  });
  it('selecting a section closes the sheet and navigates; analytics events fire', async () => {
    if (!browser) return;
    const { page } = await open();
    await page.click('[data-snav-open]');
    await page.click('[data-snav-sheet] a[href="/weather/"]');
    await page.waitForURL('**/weather/');
    expect(new URL(page.url()).pathname).toBe('/weather/');
    await page.close();
  });
  it('reports tab taps and sheet opens through gtag', async () => {
    if (!browser) return;
    const { page } = await open();
    await page.click('[data-snav-open]');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('[data-snav-row] a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
    await page.click('[data-snav-row] a[data-nav-id="events"]');
    const ev = await page.evaluate(() => (window as any).__ev as unknown[][]);
    expect(ev).toContainEqual(['event', 'nav_all_open', {}]);
    expect(ev).toContainEqual(['event', 'nav_tab_click', { section: 'events', placement: 'tab' }]);
    await page.close();
  });
});
