import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { buildElectionStatus } from './election';

// The shipped swap, bundled and run in a real browser with a fake clock. Skipped where no Chromium is
// installed (a missing browser in CI is a broken workflow).
async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}] as const) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  return null;
}
const browser = await launch();
if (!browser && process.env.CI) throw new Error('CI: no Chromium available for election-swap.test.ts (workflow must run `playwright-core install chromium`)');

describe.skipIf(!browser)('CityStatus election row swap in a real browser', { timeout: 30_000 }, () => {
  const bundle = buildSync({
    entryPoints: [new URL('./election-swap.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, format: 'iife', globalName: 'ES', write: false,
  }).outputFiles[0].text;

  // Row markup as CityStatus.astro ships it (data-swap-* from buildElectionStatus).
  const row = (tz: string, close: string, now: Date) => {
    const b = buildElectionStatus('2026-11-03', tz, close, now)!;
    const t = b.then!;
    return `<ul><li data-swap-at="${t.at}" data-swap-value="${t.value}" data-swap-href="${t.href}"><a class="city-status__link" href="/vote/"><span class="city-status__value">${b.value}</span></a></li></ul>`;
  };

  async function scenario(tz: string, close: string, startIso: string, advanceMs: number[]) {
    const page = await browser!.newPage();
    await page.clock.install({ time: new Date(startIso) });
    await page.setContent(row(tz, close, new Date(startIso)));
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as any).ES.watchElectionRows(document));
    const read = () => page.evaluate(() => `${document.querySelector('.city-status__value')!.textContent}|${(document.querySelector('a') as HTMLAnchorElement).getAttribute('href')}`);
    const seen = [await read()];
    for (const ms of advanceMs) { await page.clock.runFor(ms); seen.push(await read()); }
    await page.close();
    return seen;
  }

  it.each([
    ['Brookings', 'America/Chicago', '19:00', '2026-11-04T00:58:30Z'], // 18:58:30 CST
    ['Broomfield', 'America/Denver', '19:00', '2026-11-04T01:58:30Z'], // 18:58:30 MST
    ['Moreno Valley', 'America/Los_Angeles', '20:00', '2026-11-04T03:58:30Z'], // 19:58:30 PST
  ])('%s: an already-open tab flips within a minute of the polls closing', async (_n, tz, close, start) => {
    const [first, afterOne, afterTwo] = await scenario(tz, close, start, [60_000, 60_000]);
    expect(first).toMatch(/How to vote\|\/vote\//);
    expect(afterOne).toMatch(/How to vote/); // 30 s before closing
    expect(afterTwo).toBe('Results: unofficial · see results|/election-results/'); // 30 s after closing
  });

  it('does not flip before the polls close', async () => {
    const [, mid] = await scenario('America/Chicago', '19:00', '2026-11-04T00:57:30Z', [60_000]);
    expect(mid).toMatch(/How to vote/);
  });
});
