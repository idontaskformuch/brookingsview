#!/usr/bin/env node
// Before/after screenshots of one page on all four towns, for the owner's review (.claude/review/<phase>/).
//   node scripts/review-shots.mjs --phase phase2 --label before --path /weather/ [--towns brookings_sd,glasgow] [--wait-ms 4000]
// Each town is served by `astro dev` (SITE_CITY=<town>, reads the database like a build does, writes nothing), shot at 390 and 1280 px,
// light and dark, full page. Consent is pre-declined and analytics hosts are aborted, so no screenshot run counts as a visitor.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'site');
const req = createRequire(resolve(site, 'package.json'));
const { chromium } = req('playwright-core');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const phase = arg('phase', 'phase2');
const label = arg('label', 'after');
const path = arg('path', '/weather/');
const waitMs = Number(arg('wait-ms', '4000'));
// --api-fixture <dir>: answer GET /api/weather with <dir>/<town>.json (what the page would get after the Worker has written a newer payload).
const apiFixture = arg('api-fixture', '');
// --clock <ISO instant>: the page's browser clock (an archive page whose rows are all over by today still shows its list as it did that week).
const clockAt = arg('clock', '');
const widths = arg('widths', '390,1280').split(',').map(Number);
const schemes = arg('schemes', 'light,dark').split(',');
const TOWNS = { broomfield_co: 'broomfield', brookings_sd: 'brookings', moreno_valley_ca: 'moreno', glasgow: 'glasgow' };
const towns = arg('towns', Object.keys(TOWNS).join(',')).split(',');
const out = resolve(root, '.claude', 'review', phase);
mkdirSync(out, { recursive: true });

async function waitFor(url, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server did not answer at ${url}`);
}

let browser;
for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) { try { browser = await chromium.launch(opts); break; } catch { /* next */ } }
if (!browser) throw new Error('no browser');

let port = 4400;
for (const town of towns) {
  const p = port++;
  console.log(`== ${town} on :${p}`);
  const child = spawn(`npx astro dev --port ${p} --host 127.0.0.1`, { cwd: site, shell: true, env: { ...process.env, SITE_CITY: town, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${p}${path}`);
    for (const width of widths) {
      for (const scheme of schemes) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1, userAgent: 'ViewMediaQA/1.0 (review screenshots)' });
        await ctx.addInitScript(() => { try { localStorage.setItem('bv_cookie_consent', 'declined'); } catch { /* ignore */ } });
        if (clockAt) await ctx.clock.install({ time: new Date(clockAt) });
        const page = await ctx.newPage();
        await page.route(/google-analytics|googletagmanager|doubleclick|googlesyndication|cloudflareinsights/, (r) => r.abort());
        if (apiFixture) {
          const f = resolve(apiFixture, `${town}.json`);
          if (existsSync(f)) await page.route('**/api/weather', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(f, 'utf8') }));
        }
        const resp = await page.goto(`http://127.0.0.1:${p}${path}`, { waitUntil: 'networkidle', timeout: 120_000 });
        await page.addStyleTag({ content: 'astro-dev-toolbar,#cookie-banner{display:none!important}' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(waitMs);
        const file = resolve(out, `${town}-${label}-${width}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  ${resp?.status()} ${width} ${scheme} -> ${file}`);
        await ctx.close();
      }
    }
  } finally {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { child.kill(); }
  }
}
await browser.close();
