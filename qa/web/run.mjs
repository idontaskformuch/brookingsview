#!/usr/bin/env node
// Daily QA sweep of one live town site (Pass A: every sitemap URL, desktop, light).
// Usage: node qa/web/run.mjs --town brookings_sd [--base https://brookingsview.com] [--limit N] [--concurrency 3] [--out qa/out/brookings_sd.json]
//
// TRAFFIC HYGIENE (owner requirement 2026-10-21: QA must not pollute visitor stats):
//  * own User-Agent "ViewMediaQA/1.0 (+<base>/contact)" -- filterable server-side;
//  * localStorage bv_cookie_consent=declined BEFORE any page script runs, so the site's own
//    GA4 snippet (BaseLayout.astro) never loads and AdSense (accept-gated) never loads;
//  * analytics/ads hosts are additionally aborted at the network layer; attempts are reported
//    as qa.tracking (soft) -- if one ever shows up, a script ignores the consent gate;
//  * x-qa-bypass header (QA_BYPASS_TOKEN) is attached ONLY to first-party requests, never to
//    third parties;
//  * the run counts every request it makes (requests_total) so the baseline can be subtracted
//    where server-side analytics cannot filter by UA.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPage, checkRun, compileBlocklist, applyWaivers, ALLOW_SIBLING_SELECTOR } from './checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(resolve(root, 'site/package.json'))('playwright-core');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const town = arg('town');
if (!town) { console.error('--town required'); process.exit(2); }
const cfg = JSON.parse(readFileSync(resolve(root, `configs/${town}.json`), 'utf8'));
const base = (arg('base') ?? `https://${cfg.domain}`).replace(/\/$/, '');
const limit = Number(arg('limit', 0));
const conc = Number(arg('concurrency', 3));
const outFile = resolve(root, arg('out', `qa/out/${town}.json`));
const BYPASS = process.env.QA_BYPASS_TOKEN;
const UA = `ViewMediaQA/1.0 (+${base}/contact)`;
const BLOCKED = /(googletagmanager|google-analytics|analytics\.google|googlesyndication|doubleclick|googleadservices|cloudflareinsights|adsbygoogle)/i;
const origin = new URL(base).origin;

let requestsTotal = 0;
const firstPartyHeaders = () => ({ 'user-agent': UA, ...(BYPASS ? { 'x-qa-bypass': BYPASS } : {}) });

async function getText(url) {
  requestsTotal++;
  const r = await fetch(url, { headers: firstPartyHeaders(), redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

async function sitemapPaths() {
  const idx = await getText(`${base}/sitemap-index.xml`);
  const subs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const paths = new Set();
  for (const s of subs) {
    const xml = await getText(`${base}${new URL(s).pathname}`);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = new URL(m[1]);
      paths.add(u.pathname + u.search);
    }
  }
  return [...paths];
}

async function launch() {
  for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  throw new Error('no Chromium/Edge/Chrome available (CI: npx playwright install chromium)');
}

async function snapshot(context, path, inSitemap) {
  const page = await context.newPage();
  const consoleErrors = [], failedRequests = [], blockedAttempts = [];
  let redirects = 0;
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (BLOCKED.test(r.url())) return;
    failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400 && r.request().resourceType() !== 'document') {
      failedRequests.push(`${r.url()} (HTTP ${r.status()})`);
    }
  });
  page.on('request', (r) => { if (BLOCKED.test(r.url())) blockedAttempts.push(r.url()); });
  const url = `${base}${path}`;
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    status = resp?.status() ?? 0;
    for (let r = resp?.request().redirectedFrom(); r; r = r.redirectedFrom()) redirects++;
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500); // let client-rendered blocks settle
    const data = await page.evaluate((allowSel) => {
      document.querySelectorAll(allowSel).forEach((el) => { el.style.display = 'none'; });
      const txt = (el) => (el ? el.innerText : '');
      let lone = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.textContent.trim() === '--' && n.parentElement && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) lone++;
      }
      return {
        title: document.title, titleCount: document.querySelectorAll('title').length,
        h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()),
        metaRobots: document.querySelector('meta[name=robots]')?.content ?? '',
        metaDescription: document.querySelector('meta[name=description]')?.content ?? '',
        mainText: txt(document.querySelector('main')) || txt(document.body),
        imgAlts: [...document.querySelectorAll('main img')].map((i) => i.alt || ''),
        loneDashNodes: lone,
        brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc && !i.currentSrc.startsWith('data:')).map((i) => i.currentSrc),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      };
    }, ALLOW_SIBLING_SELECTOR);
    return { url, path, status, redirects, inSitemap, consoleErrors, failedRequests, blockedAttempts, ...data };
  } catch (e) {
    return { url, path, status: status || 0, redirects, inSitemap, title: '', titleCount: 0, h1: [], metaRobots: '', metaDescription: '',
      mainText: '', imgAlts: [], loneDashNodes: 0, brokenImgs: [], links: [], consoleErrors: [], failedRequests: [], blockedAttempts: [],
      navError: String(e.message).slice(0, 200) };
  } finally { await page.close(); }
}

async function main() {
  const started = new Date().toISOString();
  let paths = await sitemapPaths();
  if (limit) paths = paths.slice(0, limit);
  const inSitemap = new Set(paths);
  const browser = await launch();
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, timezoneId: cfg.timezone });
  await context.addInitScript(() => {
    try { localStorage.setItem('bv_cookie_consent', JSON.stringify({ choice: 'declined', ts: Date.now() })); } catch {}
  });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    requestsTotal++;
    if (BLOCKED.test(u)) return route.abort();
    if (BYPASS && u.startsWith(origin)) return route.continue({ headers: { ...route.request().headers(), 'x-qa-bypass': BYPASS } });
    return route.continue();
  });

  const snaps = [];
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < paths.length) {
      const p = paths[next++];
      snaps.push(await snapshot(context, p, true));
    }
  }));

  // internal links not in the sitemap: one GET per unique target
  const targets = new Set();
  const linkedFrom = new Map();
  for (const s of snaps) for (const h of s.links ?? []) {
    if (!h || h.startsWith('#') || /^(mailto|tel|javascript):/i.test(h)) continue;
    let u; try { u = new URL(h, s.url); } catch { continue; }
    if (u.origin !== origin) continue;
    const p = u.pathname + u.search;
    if (inSitemap.has(p) || /\.(xml|txt|pdf|ics)$/i.test(p)) continue;
    targets.add(p);
    if (!linkedFrom.has(p)) linkedFrom.set(p, s.path);
  }
  const linkFindings = [];
  const tl = [...targets];
  let ti = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (ti < tl.length) {
      const p = tl[ti++];
      requestsTotal++;
      const mk = (m) => ({ check: 'web.status', town, url: `${base}${p}`, path: p, message: `broken internal link (${m}), linked from ${linkedFrom.get(p)}` });
      try {
        const r = await context.request.get(`${base}${p}`, { headers: firstPartyHeaders(), maxRedirects: 5, timeout: 20000 });
        if (r.status() >= 400) linkFindings.push(mk(`HTTP ${r.status()}`));
      } catch (e) {
        linkFindings.push(mk(String(e.message).slice(0, 80)));
      }
    }
  }));
  await browser.close();

  const blocklist = JSON.parse(readFileSync(resolve(root, 'qa/out/blocklist.json'), 'utf8'));
  const compiled = compileBlocklist(blocklist);
  const waivers = JSON.parse(readFileSync(resolve(root, 'qa/known-issues.json'), 'utf8')).waivers;
  const today = new Date().toISOString().slice(0, 10);
  snaps.sort((a, b) => a.path.localeCompare(b.path));
  let findings = [...snaps.flatMap((s) => checkPage(s, town, compiled)), ...checkRun(snaps, town), ...linkFindings];
  findings = applyWaivers(findings, waivers, today);

  const result = { town, base, started, finished: new Date().toISOString(), pages: snaps.length, links_checked: tl.length,
    requests_total: requestsTotal, user_agent: UA, bypass_header: !!BYPASS, findings };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  const by = findings.reduce((a, f) => ((a[f.check] = (a[f.check] ?? 0) + 1), a), {});
  console.log(`[qa] ${town}: ${snaps.length} pages, ${tl.length} extra links, ${requestsTotal} requests, findings ${JSON.stringify(by)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
