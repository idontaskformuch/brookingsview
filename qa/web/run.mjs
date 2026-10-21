#!/usr/bin/env node
// QA of one live town site.
//   Pass A  every sitemap URL, desktop light, images/fonts/media BLOCKED: status + content only.
//   Pass B  key pages x {desktop,mobile} x {light,dark}: images load only in the two light combos;
//           axe (WCAG A/AA), images, empty sections, client-fill, stale alerts, past events.
//   Pass C  /today, /events, / with the browser clock set to 07:00, 19:00 and 23:30 town time
//           (past events / stale alerts / buckets that never fill), assets blocked.
//   Links   (--links on, weekly) internal links outside the sitemap + external links, once each.
// Usage: node qa/web/run.mjs --town brookings_sd [--base URL] [--pass A,B,C] [--links on|off] [--limit N] [--out file]
//
// TRAFFIC HYGIENE (owner requirement 2026-10-21: QA must not pollute visitor stats, and must not
// load the sites more than needed):
//  * own User-Agent "ViewMediaQA/1.0 (+<base>/contact)" -- filterable server-side;
//  * localStorage bv_cookie_consent=declined BEFORE any page script runs, so the site's own
//    GA4 snippet (BaseLayout.astro) never loads and AdSense (accept-gated) never loads;
//  * analytics/ads hosts are aborted at the network layer; attempts are reported as qa.tracking (soft).
//    Cloudflare's edge-injected Web Analytics beacon (cloudflareinsights) is aborted too, not reported;
//  * x-qa-bypass header (QA_BYPASS_TOKEN, optional) is attached ONLY to first-party requests;
//  * images, fonts and media are aborted in Pass A and C and in the dark combos of Pass B;
//  * `requests` in the result counts only requests that really left for the network, per pass.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkPage, checkDiag, checkRun, compileBlocklist, applyWaivers, zonedInstant, ALLOW_SIBLING_SELECTOR,
  KEY_PAGES, CLOCK_TIMES, CLOCK_PAGES,
} from './checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(resolve(root, 'site/package.json'));
const { chromium } = req('playwright-core');
const AXE_SRC = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const town = arg('town');
if (!town) { console.error('--town required'); process.exit(2); }
const cfg = JSON.parse(readFileSync(resolve(root, `configs/${town}.json`), 'utf8'));
const base = (arg('base') ?? `https://${cfg.domain}`).replace(/\/$/, '');
const passes = new Set(arg('pass', 'A,B,C').split(','));
const withLinks = arg('links', 'off') === 'on';
const limit = Number(arg('limit', 0));
const outFile = resolve(root, arg('out', `qa/out/${town}.json`));
const BYPASS = process.env.QA_BYPASS_TOKEN;
const UA = `ViewMediaQA/1.0 (+${base}/contact)`;
const BLOCKED = /(googletagmanager|google-analytics|analytics\.google|googlesyndication|doubleclick|googleadservices|cloudflareinsights|adsbygoogle)/i;
const NOISE = /(challenges\.cloudflare\.com|challenges\.cloud|cdn-cgi\/challenge-platform)/i;
const HEAVY = new Set(['image', 'font', 'media']);
const origin = new URL(base).origin;

const requests = { A: 0, B: 0, C: 0, links: 0, sitemap: 0 };
let curPass = 'sitemap';
const firstPartyHeaders = () => ({ 'user-agent': UA, ...(BYPASS ? { 'x-qa-bypass': BYPASS } : {}) });

async function getText(url) {
  requests.sitemap++;
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
  throw new Error('no Chromium/Edge/Chrome available (CI: npx playwright-core install chromium)');
}

/** One context per (viewport, theme, blockHeavy[, clock]); consent pre-declined, tracking aborted. */
async function newContext(browser, { mobile = false, theme = 'light', blockHeavy = true, clockAt = null }) {
  const context = await browser.newContext({
    userAgent: UA, timezoneId: cfg.timezone, colorScheme: theme,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('bv_cookie_consent', JSON.stringify({ choice: 'declined', ts: Date.now() }));
      localStorage.setItem('bv_theme', t);
    } catch {}
  }, theme);
  if (clockAt) await context.clock.install({ time: clockAt });
  await context.route('**/*', (route) => {
    const r = route.request();
    const u = r.url();
    if (BLOCKED.test(u)) return route.abort();
    if (blockHeavy && HEAVY.has(r.resourceType())) return route.abort();
    requests[curPass]++;
    if (BYPASS && u.startsWith(origin)) return route.continue({ headers: { ...r.headers(), 'x-qa-bypass': BYPASS } });
    return route.continue();
  });
  return context;
}

/** Everything the checks need, read in the page (so the page's own clock -- real or faked -- applies). */
function pageProbe({ allowSel, wantLinks }) {
  document.querySelectorAll(allowSel).forEach((el) => { el.style.display = 'none'; });
  const now = new Date();
  const visible = (el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);
  const txt = (el) => (el ? el.innerText : '');
  let lone = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.textContent.trim() === '--' && n.parentElement && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) lone++;
  }
  // sections that show a heading and nothing else: climb from the <h2> (max 3 levels, stop at a
  // section/article/aside) until something with real content shows up; none found = empty
  const emptySections = [];
  const mainEl = document.querySelector('main');
  document.querySelectorAll('main h2').forEach((h) => {
    if (!visible(h)) return;
    const hText = h.innerText;
    let box = h, ok = false;
    for (let lvl = 0; lvl < 3 && !ok; lvl++) {
      box = box.parentElement;
      if (!box || box === mainEl) { box = null; break; }
      const rest = (box.innerText || '').replace(hText, '').trim();
      ok = rest.length >= 3 || !!box.querySelector('img, a, li, table, canvas, svg, iframe, input, button');
      if (!ok && ['SECTION', 'ARTICLE', 'ASIDE'].includes(box.tagName)) break;
    }
    if (!ok && box) emptySections.push(hText.trim().slice(0, 60));
  });
  // /today: template has events but nothing was filled and no "nothing scheduled" note
  const tpl = document.getElementById('today-event-items');
  const bucketShown = (id) => { const b = document.getElementById(id); return !!b && !b.hidden && visible(b); };
  const noneEl = document.getElementById('today-no-events');
  const clientfill = tpl ? {
    items: [...tpl.content.children].filter((c) => c.tagName === 'LI').length,
    tonight: bucketShown('today-tonight'), tomorrow: bucketShown('today-tomorrow'),
    none: !!noneEl && !noneEl.hidden && visible(noneEl),
  } : null;
  // alerts still visible after their end
  const staleAlerts = [];
  document.querySelectorAll('[data-ends]').forEach((el) => {
    const e = Date.parse(el.getAttribute('data-ends'));
    if (!Number.isNaN(e) && e < now.getTime() && visible(el)) staleAlerts.push(`${el.getAttribute('data-ends')} :: ${(el.innerText || '').trim().slice(0, 70)}`);
  });
  // events in the Tonight / Tomorrow buckets that are over, or not tomorrow
  const tz = tpl?.dataset.tz || undefined;
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const today = dayKey(now), tomorrow = dayKey(new Date(now.getTime() + 24 * 3600 * 1000));
  const pastEvents = [];
  for (const [id, wantDay] of [['today-tonight', null], ['today-tomorrow', tomorrow]]) {
    document.querySelectorAll(`#${id} li[data-start]`).forEach((li) => {
      const s = Date.parse(li.dataset.start), e = li.dataset.end ? Date.parse(li.dataset.end) : null;
      const label = `${id.replace('today-', '')}: ${(li.innerText || '').trim().split('\n')[0].slice(0, 60)} (${li.dataset.start})`;
      if (id === 'today-tonight') {
        // same rule as lib/local-day.ts eventEndsAt: an end only counts if it is after the start, else start + 3 h
        const endsAt = e !== null && e > s ? e : s + 3 * 3600 * 1000;
        if (endsAt <= now.getTime()) pastEvents.push(label);
        else if (dayKey(new Date(s)) > today) pastEvents.push(label + ' [not today]');
      } else if (dayKey(new Date(s)) !== wantDay) pastEvents.push(label + ' [not tomorrow]');
    });
  }
  return {
    nowIso: now.toISOString(),
    title: document.title, titleCount: document.querySelectorAll('title').length,
    h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()),
    metaRobots: document.querySelector('meta[name=robots]')?.content ?? '',
    metaDescription: document.querySelector('meta[name=description]')?.content ?? '',
    mainText: txt(document.querySelector('main')) || txt(document.body),
    imgAlts: [...document.querySelectorAll('main img')].map((i) => i.alt || ''),
    loneDashNodes: lone,
    brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc && !i.currentSrc.startsWith('data:')).map((i) => i.currentSrc),
    emptySections, clientfill, staleAlerts, pastEvents,
    links: wantLinks ? [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : [],
  };
}

async function snapshot(context, path, { inSitemap = false, blockHeavy = true, axe = false, label = '', wantLinks = false } = {}) {
  const page = await context.newPage();
  const consoleErrors = [], failedRequests = [], blockedAttempts = [];
  let redirects = 0, status = 0, cfMitigated = '';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location()?.url ?? '';
    if (BLOCKED.test(loc) || NOISE.test(loc)) return;
    if (/^Failed to load resource: net::ERR_FAILED/.test(m.text()) && blockHeavy) return; // our own image/font aborts
    if (/^Refused to connect to 'data:,'/.test(m.text()) || /^%c%d font-size:0/.test(m.text())) return;
    consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (BLOCKED.test(r.url()) || NOISE.test(r.url())) return;
    if (blockHeavy && HEAVY.has(r.resourceType())) return; // our own abort
    failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400 && r.request().resourceType() !== 'document') failedRequests.push(`${r.url()} (HTTP ${r.status()})`);
  });
  page.on('request', (r) => { if (BLOCKED.test(r.url()) && !/cloudflareinsights/i.test(r.url())) blockedAttempts.push(r.url()); });
  const url = `${base}${path}`;
  const snap = { url, path, label, inSitemap, imagesBlocked: blockHeavy };
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    status = resp?.status() ?? 0;
    cfMitigated = resp?.headers()['cf-mitigated'] ?? '';
    for (let r = resp?.request().redirectedFrom(); r; r = r.redirectedFrom()) redirects++;
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500); // let client-rendered blocks settle
    const data = await page.evaluate(pageProbe, { allowSel: ALLOW_SIBLING_SELECTOR, wantLinks });
    let axeViolations = [];
    if (axe) {
      await page.evaluate(AXE_SRC);
      axeViolations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ').slice(0, 90)) }));
      });
    }
    return { ...snap, status, cfMitigated, redirects, consoleErrors, failedRequests, blockedAttempts, axe: axeViolations, ...data };
  } catch (e) {
    return { ...snap, status: status || 0, cfMitigated, redirects, title: '', titleCount: 0, h1: [], metaRobots: '', metaDescription: '',
      mainText: '', imgAlts: [], loneDashNodes: 0, brokenImgs: [], links: [], consoleErrors: [], failedRequests: [], blockedAttempts: [],
      emptySections: [], clientfill: null, staleAlerts: [], pastEvents: [], axe: [], navError: String(e.message).slice(0, 200) };
  } finally { await page.close(); }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function linkChecks(context, snaps, inSitemap) {
  const internal = new Map(), external = new Map();
  for (const s of snaps) for (const h of s.links ?? []) {
    if (!h || h.startsWith('#') || /^(mailto|tel|javascript|sms):/i.test(h)) continue;
    let u; try { u = new URL(h, s.url); } catch { continue; }
    if (u.origin === origin) {
      const p = u.pathname + u.search;
      if (inSitemap.has(p) || /\.(xml|txt|pdf|ics)$/i.test(p)) continue;
      if (!internal.has(p)) internal.set(p, s.path);
    } else if (/^https?:$/.test(u.protocol)) {
      const k = u.origin + u.pathname + u.search;
      if (!external.has(k)) external.set(k, s.path);
    }
  }
  curPass = 'links';
  const out = [];
  await pool([...internal], 4, async ([p, from]) => {
    requests.links++;
    const mk = (m) => ({ check: 'web.status', town, url: `${base}${p}`, path: p, message: `broken internal link (${m}), linked from ${from}` });
    try {
      const r = await context.request.get(`${base}${p}`, { headers: firstPartyHeaders(), maxRedirects: 5, timeout: 20000 });
      if (r.status() >= 400) out.push(mk(`HTTP ${r.status()}`));
    } catch (e) { out.push(mk(String(e.message).slice(0, 80))); }
  });
  // external: one request each, one host at a time, politely spaced; 401/403/429 are bot walls, not breakage
  const byHost = new Map();
  for (const [k, from] of external) { const h = new URL(k).host; (byHost.get(h) ?? byHost.set(h, []).get(h)).push([k, from]); }
  await pool([...byHost.values()], 4, async (list) => {
    for (const [k, from] of list) {
      try {
        const r = await fetch(k, { method: 'GET', headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (r.status >= 400 && ![401, 403, 429].includes(r.status)) out.push({ check: 'web.extlink', town, url: k, path: from, message: `external link HTTP ${r.status}, linked from ${from}` });
        await r.body?.cancel();
      } catch (e) { out.push({ check: 'web.extlink', town, url: k, path: from, message: `external link unreachable (${String(e.cause?.code ?? e.message).slice(0, 60)}), linked from ${from}` }); }
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
  return { findings: out, checked: internal.size + external.size };
}

async function main() {
  const started = new Date().toISOString();
  let paths = await sitemapPaths();
  if (limit) paths = paths.slice(0, limit);
  const inSitemap = new Set(paths);
  const keyPaths = KEY_PAGES.filter((p) => inSitemap.has(p) || (limit && paths.includes(p)));
  const browser = await launch();
  const snapsA = [], snapsBC = [];
  const counts = {};

  if (passes.has('A') || withLinks) {
    curPass = 'A';
    const ctx = await newContext(browser, {});
    await pool(paths, 3, async (p) => { snapsA.push(await snapshot(ctx, p, { inSitemap: true, wantLinks: withLinks })); });
    counts.A = snapsA.length;
    await ctx.close();
  }

  if (passes.has('B')) {
    curPass = 'B';
    counts.B = 0;
    const combos = [
      { name: 'desktop-light', mobile: false, theme: 'light', blockHeavy: false },
      { name: 'mobile-light', mobile: true, theme: 'light', blockHeavy: false },
      { name: 'desktop-dark', mobile: false, theme: 'dark', blockHeavy: true },
      { name: 'mobile-dark', mobile: true, theme: 'dark', blockHeavy: true },
    ];
    for (const c of combos) {
      const ctx = await newContext(browser, c);
      await pool(keyPaths, 2, async (p) => {
        snapsBC.push(await snapshot(ctx, p, { inSitemap: true, blockHeavy: c.blockHeavy, axe: true, label: c.name }));
        counts.B++;
      });
      await ctx.close();
    }
  }

  if (passes.has('C')) {
    curPass = 'C';
    counts.C = 0;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date());
    for (const hhmm of CLOCK_TIMES) {
      const at = zonedInstant(day, hhmm, cfg.timezone);
      const ctx = await newContext(browser, { clockAt: at });
      await pool(CLOCK_PAGES.filter((p) => inSitemap.has(p)), 2, async (p) => {
        snapsBC.push(await snapshot(ctx, p, { inSitemap: true, label: `@${hhmm}`, blockHeavy: true }));
        counts.C++;
      });
      await ctx.close();
    }
  }

  let linkFindings = [], linksChecked = 0;
  if (withLinks) {
    const ctx = await newContext(browser, {});
    const r = await linkChecks(ctx, snapsA, inSitemap);
    linkFindings = r.findings; linksChecked = r.checked;
    await ctx.close();
  }
  await browser.close();

  const blocklist = JSON.parse(readFileSync(resolve(root, 'qa/out/blocklist.json'), 'utf8'));
  const compiled = compileBlocklist(blocklist);
  const waivers = JSON.parse(readFileSync(resolve(root, 'qa/known-issues.json'), 'utf8')).waivers;
  const today = new Date().toISOString().slice(0, 10);
  snapsA.sort((a, b) => a.path.localeCompare(b.path));
  const all = [
    ...snapsA.flatMap((s) => checkPage(s, town, compiled)),
    ...snapsBC.flatMap((s) => [...checkPage(s, town, compiled), ...checkDiag(s, town)]),
    ...checkRun(snapsA, town), ...linkFindings,
  ];
  // the same defect seen in several combos is one finding per (check, path, message-sans-label)
  const seen = new Set();
  let findings = all.filter((f) => { const k = `${f.check}|${f.path}|${f.message}`; return seen.has(k) ? false : (seen.add(k), true); });
  findings = applyWaivers(findings, waivers, today);

  // proof that the fake clock really reached the page: first page's own Date per Pass C label
  const clock_seen = {};
  for (const s of snapsBC) if (s.label?.startsWith('@') && s.nowIso && !clock_seen[s.label]) clock_seen[s.label] = s.nowIso;

  const total = Object.values(requests).reduce((a, b) => a + b, 0);
  const result = { town, base, started, finished: new Date().toISOString(), passes: [...passes], loads: counts, links_checked: linksChecked,
    pages: counts.A ?? 0, requests, requests_total: total, clock_seen, user_agent: UA, bypass_header: !!BYPASS, findings };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  const by = findings.reduce((a, f) => ((a[f.check] = (a[f.check] ?? 0) + 1), a), {});
  console.log(`[qa] ${town}: loads ${JSON.stringify(counts)}, requests ${JSON.stringify(requests)} = ${total}, findings ${JSON.stringify(by)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
