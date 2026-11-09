import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import TonightRows from '../components/tonight/TonightRows.astro';
import type { EveningEntry } from './evening-items';
import type { CardTown } from './tonight-cards';

// Live time on /tonight (owner 2026-11-09): the event rows are PopEventList rows, and the browser script (lib/tonight-cards-client.ts, step 3) writes "On now" /
// "in N min" into each row's [data-tc-time] label and sets .is-now / .is-soon. It silently stopped when the rows moved to the date-tile list (no [data-tc-time] left);
// these tests fail if the label disappears from the rows again, in the markup the page really renders and in a real browser.
const TZ = 'Europe/London';
const town: CardTown = { country: 'gb', homeCity: 'Glasgow', center: { lat: 55.86, lon: -4.25 }, hidePrice: true, cityLabels: true, bigShows: false };
const at = (hhmm: string) => `2026-11-04T${hhmm}:00.000Z`; // GMT in November
const entry = (id: string, start: string, o: Partial<EveningEntry> = {}): EveningEntry => ({
  id, title: `Show ${id}`, start, end: null, group: 'Live music', labels: [], venue: 'Venue', href: `/s/${id}/`, source: 'own',
  distanceMiles: null, driveMinutes: null, checked: '2026-11-04', ...o,
});
const ENTRIES = [entry('a', at('18:30')), entry('b', at('19:30')), entry('c', at('21:00'))]; // now = 19:00: a is on, b in 30 min, c later

async function render(): Promise<string> {
  const c = await AstroContainer.create();
  return c.renderToString(TonightRows, { props: { id: 'tn-tonight', entries: ENTRIES, late: [], tz: TZ, regions: {}, town, osmChecked: '2026-11-04', tonight: true } });
}

describe('the /tonight event rows carry the live-time label', () => {
  it('every event row has exactly one [data-tc-time] label inside its [data-card] row, in a [data-tc-rows] list', async () => {
    const html = await render();
    const rows = html.match(/<li [^>]*data-card[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(ENTRIES.length);
    for (const row of rows) expect((row.match(/data-tc-time/g) ?? []).length, row.slice(0, 120)).toBe(1);
    expect(html).toMatch(/<ul[^>]*data-tc-rows/);
  });
  it('the page passes `live` and nothing else prints event rows without it', () => {
    expect(readFileSync(new URL('../components/tonight/TonightRows.astro', import.meta.url), 'utf8')).toMatch(/<PopEventList[^>]*\blive\b/);
    expect(readFileSync(new URL('../components/pop/PopEventList.astro', import.meta.url), 'utf8')).toMatch(/data-tc-time/);
  });
});

async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}
const browser = await launch();
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for tonight-live-time.test.ts');

describe.skipIf(!browser)('the shipped script fills the label in a real browser', { timeout: 60_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./tonight-cards-client.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'TC', write: false,
  }).outputFiles[0].text;

  it('"On now" and "in 30 min" appear for the right rows (and .is-now / .is-soon), a later row stays empty; the clock time is not repeated', async () => {
    const html = await render();
    const page = await browser!.newPage();
    await page.clock.install({ time: new Date(at('19:00')) });
    // the day number the script's sectionState reads is the UTC day (days since epoch) of the evening
    const day = Math.floor(Date.parse(at('19:00')) / 86_400_000);
    await page.setContent(`<!doctype html><body><div data-tc data-tz="${TZ}"><section data-evening-day="${day}" data-tz="${TZ}"><h2 data-evening-heading>Tonight</h2>${html}</section></div></body>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as any).TC.initTonightCards(document));
    const out = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-card]')].map((li) => {
      const t = li.querySelector<HTMLElement>('[data-tc-time]');
      return { id: li.dataset.id, text: t?.textContent ?? null, hidden: t?.hidden ?? null, now: li.classList.contains('is-now'), soon: li.classList.contains('is-soon') };
    }));
    await page.close();
    const by = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(by.a).toMatchObject({ text: 'On now', hidden: false, now: true, soon: false });
    expect(by.b).toMatchObject({ text: 'in 30 min', hidden: false, now: false, soon: true });
    expect(by.c).toMatchObject({ text: '', hidden: true, now: false, soon: false });
  });
});
