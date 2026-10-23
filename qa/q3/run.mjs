#!/usr/bin/env node
// QA Q3 -- weekly AI review of page TYPES (owner order 2026-10-23, .claude/spec-qa-q3.md).
//
// For each town: find one representative page per page type (section pages + one detail page per list page),
// load it on a phone viewport in light AND dark mode WITH images, take screenshots, extract facts, run
// deterministic checks and ask an AI reviewer to apply the owner's checklist. Output: qa/out/q3/<date>/
// (pages.json, report.html, screenshots/).
//
// Usage: node qa/q3/run.mjs [--towns brookings_sd,moreno_valley_ca,broomfield_co,glasgow] [--review on|off]
//                           [--model claude-opus-5-5] [--max-usd 12] [--limit N] [--out dir]
//
// TRAFFIC HYGIENE (same rules as qa/web/run.mjs -- CLAUDE.md rule 12; do not weaken):
//  * own User-Agent "ViewMediaQA/1.0 (+<base>/contact)";
//  * localStorage bv_cookie_consent=declined BEFORE any page script runs, analytics/ads hosts aborted at the network layer;
//  * x-qa-bypass (QA_BYPASS_TOKEN, optional) only to the site's own origin;
//  * ~2 page loads per page type (light + dark) + one plain fetch per candidate path, per town, per run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LITERAL_RE } from '../web/checks.mjs';
import { CHECKLIST, deterministicFindings, buildReviewPrompt, parseReview, duplicateSentences, currentSeason, buildPairPrompt, parsePairReview } from './review.mjs';
import { writeReport } from './report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(resolve(root, 'site/package.json'));
const { chromium } = req('playwright-core');
const AXE_SRC = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TOWNS = arg('towns', 'brookings_sd,moreno_valley_ca,broomfield_co,glasgow').split(',');
const REVIEW = arg('review', 'on') === 'on';
const MODEL = arg('model', 'claude-opus-5-5');
const MAX_USD = Number(arg('max-usd', 12));
const LIMIT = Number(arg('limit', 0));
const today = new Date().toISOString().slice(0, 10);
const outDir = resolve(root, arg('out', `qa/out/q3/${today}`));
const shotDir = resolve(outDir, 'screenshots');
mkdirSync(shotDir, { recursive: true });
const BYPASS = process.env.QA_BYPASS_TOKEN;
const BLOCKED = /(googletagmanager|google-analytics|analytics\.google|googlesyndication|doubleclick|googleadservices|cloudflareinsights|adsbygoogle)/i;
// Assumed Opus-class price (USD per million tokens) used ONLY for the --max-usd cap and the cost line; the repo has no Opus price.
const PRICE_IN = 15 / 1e6, PRICE_OUT = 75 / 1e6;

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
  } catch { /* no .env */ }
}
loadEnv();

/** Candidate section paths; kept only when they answer 200 without redirecting away. */
const CANDIDATES = ['/', '/today/', '/events/', '/whats-on/', '/this-week/', '/city-hall/', '/weather/', '/traffic/', '/closures/', '/jobs/',
  '/facilities/', '/university/', '/sports/', '/jackrabbits/', '/vote/', '/election-results/', '/thanksgiving/', '/trash-recycling/', '/game-day/',
  '/how-city-council-works/', '/sdsu-campus-open-to-public/', '/new-in-town/', '/workplace-watch/', '/home-sales/', '/farm-report/', '/vail-resorts/',
  '/about/', '/contact/', '/privacy/', '/cookies/'];
/** list page -> link pattern of a representative DETAIL page found inside it. */
const DETAIL_OF = { '/events/': /^\/s\/event-[^/]+\/$/, '/city-hall/': /^\/s\/[^/]+\/$/, '/this-week/': /^\/this-week\/[^/]+\/$/,
  '/facilities/': /^\/facilities\/[^/]+\/$/, '/jobs/': /^\/jobs\/[^/]+\/$/, '/university/': /^\/s\/university-digest-[^/]+\/$/, '/home-sales/': /^\/home-sales\/[^/]+\/$/ };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  throw new Error('no Chromium/Edge/Chrome available');
}

async function newContext(browser, { theme, tz, base, origin }) {
  const UA = `ViewMediaQA/1.0 (+${base}/contact)`;
  const context = await browser.newContext({
    userAgent: UA, timezoneId: tz, colorScheme: theme, locale: 'en-GB',
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('bv_cookie_consent', JSON.stringify({ choice: 'declined', ts: Date.now() }));
      localStorage.setItem('bv_theme', t);
    } catch { /* storage may throw */ }
  }, theme);
  await context.route('**/*', (route) => {
    const r = route.request();
    if (BLOCKED.test(r.url())) return route.abort();
    if (BYPASS && r.url().startsWith(origin)) return route.continue({ headers: { ...r.headers(), 'x-qa-bypass': BYPASS } });
    return route.continue();
  });
  return { context, UA };
}

/** Runs inside the page: facts the checks and the reviewer need. */
function probe() {
  // textContent of a clone without script/style: innerText would apply CSS text-transform (kickers come out ALL CAPS)
  const txt = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('script, style, noscript, template, svg').forEach((e) => e.remove());
    return (c.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  };
  const main = document.querySelector('main') || document.body;
  const shell = (() => {
    const c = document.body.cloneNode(true);
    c.querySelectorAll('main, script, style, noscript, template, svg').forEach((e) => e.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  })();
  const headings = [...main.querySelectorAll('h1,h2,h3')];
  const emptyHeadings = [];
  for (const h of headings) {
    let has = false;
    // content follows the heading, or follows the wrapper the heading sits in (one level up)
    for (let node = h, lvl = 0; lvl < 2 && !has && node; lvl++, node = node.parentElement) {
      let n = node.nextElementSibling;
      while (n && !/^H[1-3]$/.test(n.tagName)) { if ((n.textContent || '').trim().length > 0 || n.querySelector('img,a,li')) { has = true; break; } n = n.nextElementSibling; }
    }
    // a card title (heading inside an article/list item/card) is not a section heading: its text sits around it, not below it
    if (!has && !(h.tagName === 'H1') && !h.closest('article, li, [class*="card"], [class*="item"]')) emptyHeadings.push((h.textContent || '').trim());
  }
  const paras = [...main.querySelectorAll('p')].map((p) => (p.innerText || '').trim().split(/\s+/).filter(Boolean).length);
  const imgs = [...main.querySelectorAll('img')].map((i) => ({
    src: i.currentSrc || i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight, ok: i.complete && i.naturalWidth > 0,
    credit: (i.closest('figure')?.innerText || '').trim().slice(0, 120),
  }));
  // dated items, except those under a heading that says they are past on purpose ("Recently", "Past events", "Earlier weeks")
  const PAST_SECTION = /recent|past|earlier|archive|last week|ago/i;
  const times = [...main.querySelectorAll('time[datetime], [data-start]')]
    .filter((e) => { const sec = e.closest('section'); const h = sec && sec.querySelector('h2, h3'); return !(h && PAST_SECTION.test(h.textContent || '')); })
    .map((e) => e.getAttribute('datetime') || e.getAttribute('data-start')).filter(Boolean);
  const links = [...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute('href'));
  return {
    title: document.title, h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()),
    mainText: txt(main), shellText: shell, wordCount: txt(main).split(/\s+/).filter(Boolean).length,
    emptyHeadings, paragraphWords: paras, images: imgs, timestamps: times.slice(0, 200), links,
    htmlLang: document.documentElement.lang, scrollHeight: document.documentElement.scrollHeight,
  };
}

async function contrast(page) {
  try {
    await page.evaluate(AXE_SRC);
    const r = await page.evaluate(async () => {
      const res = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
      return res.violations.flatMap((v) => v.nodes.map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n')[1] || '' })));
    });
    return r;
  } catch { return []; }
}

async function shoot(page, base, label) {
  // viewport (above the fold) for the report + full-page segments (<=1500 px each, max 3) for the reviewer
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(400);
  const fold = resolve(shotDir, `${label}-fold.jpg`);
  await page.screenshot({ path: fold, type: 'jpeg', quality: 62 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const segs = [];
  for (let i = 0; i < 3 && i * 1500 < height; i++) {
    const p = resolve(shotDir, `${label}-seg${i + 1}.jpg`);
    await page.screenshot({ path: p, type: 'jpeg', quality: 55, fullPage: true, clip: { x: 0, y: i * 1500, width: 390, height: Math.min(1500, height - i * 1500) } });
    segs.push(p);
  }
  return { fold, segs, height };
}

async function reviewWithAi(prompt, images) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY saknas');
  const content = [{ type: 'text', text: prompt.user }];
  for (const im of images) {
    content.push({ type: 'text', text: im.caption });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(im.path).toString('base64') } });
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3500, system: prompt.system, messages: [{ role: 'user', content }] }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return { text: body.content?.map((c) => c.text ?? '').join('') ?? '', usage: body.usage ?? {} };
}

let spentUsd = 0, inTok = 0, outTok = 0;
const perTown = {}; // town -> {input, output, usd, calls}
function addUsage(town, rec, usage) {
  const i = usage.input_tokens ?? 0, o = usage.output_tokens ?? 0;
  inTok += i; outTok += o; spentUsd = inTok * PRICE_IN + outTok * PRICE_OUT;
  const t = (perTown[town] ??= { input: 0, output: 0, usd: 0, calls: 0 });
  t.input += i; t.output += o; t.calls += 1; t.usd = t.input * PRICE_IN + t.output * PRICE_OUT;
  rec.usage = { input: (rec.usage?.input ?? 0) + i, output: (rec.usage?.output ?? 0) + o };
}

async function runTown(browser, town) {
  const cfg = JSON.parse(readFileSync(resolve(root, `configs/${town}.json`), 'utf8'));
  const base = `https://${cfg.domain}`; const origin = new URL(base).origin;
  const UA = `ViewMediaQA/1.0 (+${base}/contact)`;
  const hdr = { 'user-agent': UA, ...(BYPASS ? { 'x-qa-bypass': BYPASS } : {}) };
  console.log(`\n== ${town} (${base})`);

  // 1. which candidate sections exist (plain fetch, no redirect-away)
  const found = [];
  for (const p of CANDIDATES) {
    try {
      const r = await fetch(base + p, { headers: hdr, redirect: 'manual' });
      // a gated page in a static build answers 200 with a meta-refresh to / (Astro.redirect): not a real page of this town
      if (r.status === 200 && !/http-equiv=["']refresh/i.test(await r.text())) found.push(p);
    } catch { /* unreachable */ }
    await sleep(120);
  }
  console.log(`   sections: ${found.length}`);

  const light = await newContext(browser, { theme: 'light', tz: cfg.timezone, base, origin });
  const dark = await newContext(browser, { theme: 'dark', tz: cfg.timezone, base, origin });
  const todo = found.map((p) => ({ path: p, kind: 'section' }));
  const pages = [];
  const seen = new Set();
  const now = new Date();

  async function visit(item) {
    const label = `${town}-${item.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}`;
    const rec = { town, path: item.path, kind: item.kind, label, url: base + item.path, findings: [] };
    const results = {};
    for (const [mode, ctx] of [['light', light], ['dark', dark]]) {
      const page = await ctx.context.newPage();
      try {
        // 'load' + a short idle wait: a page with a challenge widget (the contact form's Turnstile) never reaches full network idle
        const resp = await page.goto(base + item.path, { waitUntil: 'load', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        rec.status = resp?.status();
        const facts = await page.evaluate(probe);
        const shots = await shoot(page, base, `${label}-${mode}`);
        const bad = await contrast(page);
        results[mode] = { facts, shots, contrast: bad };
      } catch (e) {
        rec.findings.push({ check: 'load', severity: 'high', source: 'det', where: item.path, evidence: String(e.message).slice(0, 200), cause: 'page did not load in the QA browser' });
      } finally { await page.close(); }
      await sleep(250);
    }
    rec.light = results.light; rec.dark = results.dark;
    return rec;
  }

  for (const item of todo) {
    if (LIMIT && pages.length >= LIMIT) break;
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    const rec = await visit(item);
    pages.push(rec);
    process.stdout.write(`   ${item.path} ${rec.status ?? '?'} `);
    // representative DETAIL page from a list page
    const re = DETAIL_OF[item.path];
    const links = rec.light?.facts?.links ?? [];
    const detail = re ? links.find((l) => re.test(l) && l !== item.path) : null;
    if (detail && !seen.has(detail)) todo.push({ path: detail, kind: `detail of ${item.path}` });
  }
  console.log('');
  await light.context.close(); await dark.context.close();

  // 2. cross-page checks for the town, then deterministic findings and the AI review
  const dup = duplicateSentences(pages.map((p) => ({ path: p.path, text: p.light?.facts?.mainText ?? '' })));
  const season = currentSeason(now, cfg.coordinates?.lat ?? 40);
  for (const rec of pages) {
    rec.findings.push(...deterministicFindings(rec, { town, now, dup, season }));
    if (!REVIEW) continue;
    if (spentUsd >= MAX_USD) { rec.reviewSkipped = `spend cap ${MAX_USD} USD reached`; continue; }
    const prompt = buildReviewPrompt(rec, { town, cfg, now, dup });
    const images = [];
    for (const [mode, label] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      const segs = rec[mode]?.shots?.segs ?? [];
      segs.slice(0, mode === 'light' ? 3 : 2).forEach((p, i) => images.push({ path: p, caption: `Screenshot ${label} mode, phone, part ${i + 1} (each part is 1500 px tall):` }));
    }
    try {
      const out = await reviewWithAi(prompt, images);
      addUsage(town, rec, out.usage);
      rec.aiRaw = out.text.slice(0, 6000); // kept so a bad reply can be inspected, not guessed at
      rec.findings.push(...parseReview(out.text));
      process.stdout.write('.');
    } catch (e) {
      rec.reviewError = String(e.message).slice(0, 300);
      console.log(`\n   review failed for ${rec.path}: ${rec.reviewError}`);
    }
  }
  // 3. pair review: each LIST page with its DETAIL page side by side (owner 2026-10-23, born_from the University digest finding)
  if (REVIEW) {
    for (const det of pages.filter((p) => p.kind.startsWith('detail of '))) {
      const list = pages.find((p) => p.path === det.kind.slice('detail of '.length));
      if (!list || spentUsd >= MAX_USD) continue;
      try {
        const prompt = buildPairPrompt(list, det, { town, cfg, now });
        const images = [];
        for (const [rec, name] of [[list, 'LIST'], [det, 'DETAIL']]) {
          const seg = rec.light?.shots?.segs?.[0];
          if (seg) images.push({ path: seg, caption: `${name} page, phone, light mode, first part:` });
        }
        const out = await reviewWithAi(prompt, images);
        addUsage(town, list, out.usage);
        const parsed = parsePairReview(out.text, list.path, det.path);
        list.findings.push(...parsed.findings);
        list.pair = parsed.pair;
        process.stdout.write('p');
      } catch (e) {
        list.reviewError = `pair review: ${String(e.message).slice(0, 200)}`;
      }
    }
  }
  console.log(`\n   ${town}: ${pages.reduce((n, p) => n + p.findings.length, 0)} findings; AI spend so far ~$${spentUsd.toFixed(2)}`);
  return pages;
}

async function main() {
  const browser = await launch();
  const all = [];
  for (const town of TOWNS) all.push(...(await runTown(browser, town)));
  await browser.close();
  const summary = { date: today, model: REVIEW ? MODEL : null, tokens: { input: inTok, output: outTok }, perTown, estimatedUsd: Number(spentUsd.toFixed(2)),
    priceAssumption: 'USD 15 / 75 per million input/output tokens (assumed Opus-class; no Opus price in the repo)', checklist: CHECKLIST };
  // drop bulky per-page raw text from the JSON we keep, but keep facts the report needs
  writeFileSync(resolve(outDir, 'pages.json'), JSON.stringify({ summary, pages: all }, null, 1));
  writeReport(outDir, { summary, pages: all });
  for (const [t, v] of Object.entries(perTown)) console.log(`  ${t}: ${v.calls} calls, ${v.input} in / ${v.output} out tokens, ~$${v.usd.toFixed(2)}`);
  console.log(`\nReport: ${resolve(outDir, 'report.html')}\nAI: ${inTok} in / ${outTok} out tokens, ~$${spentUsd.toFixed(2)} (assumed price)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
