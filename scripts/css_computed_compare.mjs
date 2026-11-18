// Jämför BERÄKNADE stilar (getComputedStyle) element för element mellan två dist-kopior av samma stad
// (astro 7-fasen, .claude/specs/astro-7.md). Svarar på frågan om en ändrad CSS-ordning/minifiering syns för läsaren.
//
//   node scripts/css_computed_compare.mjs <före-rot> <efter-rot> <stad> [max-sidor=60]
//
// <rot>/<stad>/ är en hel dist. JavaScript avstängt (bara CSS avgör), externa anrop blockeras.
// Urval: varje sidtyp (första sökvägsdelen) + startsidan, högst max-sidor. Lägen: 1280 px ljust, 390 px ljust,
// 1280 px mörkt. Exit 0 alltid när jämförelsen gick att köra; skillnader är rapport.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'site', 'package.json'))('playwright-core');

const [beforeRoot, afterRoot, town, maxArg] = process.argv.slice(2);
if (!beforeRoot || !afterRoot || !town) { console.error('usage: node scripts/css_computed_compare.mjs <före-rot> <efter-rot> <stad> [max-sidor]'); process.exit(2); }
const MAX = Number(maxArg ?? 60);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

function serve(dir) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

function pages(dir) {
  const all = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== '_astro') walk(p); }
      else if (e.name === 'index.html') all.push('/' + path.relative(dir, d).replace(/\\/g, '/') + (d === dir ? '' : '/'));
    }
  })(dir);
  const byType = new Map();
  for (const u of all.sort()) { const t = u.split('/')[1] || '(start)'; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(u); }
  const pick = [];
  for (const list of byType.values()) pick.push(list[0]);
  for (const list of byType.values()) for (const u of list.slice(1, 3)) pick.push(u);
  return [...new Set(pick)].slice(0, MAX).map((u) => u.replace(/^\/\//, '/'));
}

// Ett element = "id\u0002värde1\u0001värde2..." i fast egenskapsordning (första elementets lista).
const SNAP = () => {
  // Icke-renderade element räknas inte: ett flyttat <script> skulle annars förskjuta parningen av alla efterföljande element.
  const els = document.querySelectorAll('body, body *:not(script):not(style):not(link):not(template):not(noscript)');
  const keys = Array.from(getComputedStyle(document.body));
  const rows = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    const id = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
    rows.push(id + '\u0002' + keys.map((k) => cs.getPropertyValue(k)).join('\u0001'));
  }
  return { keys, rows };
};

const A = path.join(beforeRoot, town);
const B = path.join(afterRoot, town);
const [sa, sb] = await Promise.all([serve(A), serve(B)]);
const ua = `http://127.0.0.1:${sa.address().port}`;
const ub = `http://127.0.0.1:${sb.address().port}`;
let browser = null;
for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) { try { browser = await chromium.launch(opts); break; } catch { /* nästa */ } }
if (!browser) { console.error('ingen webbläsare'); process.exit(2); }

const MODES = [
  { name: '1280 ljust', viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
  { name: '390 ljust', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: '1280 mörkt', viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
];
// EXTRA_PAGES=<fil med en sökväg per rad, t.ex. "closures/index.html"> läggs alltid med (dist_compare:s CSS-ändrade sidor).
const extra = process.env.EXTRA_PAGES && fs.existsSync(process.env.EXTRA_PAGES)
  ? fs.readFileSync(process.env.EXTRA_PAGES, 'utf8').split(/\r?\n/).filter(Boolean).map((f) => '/' + f.replace(/index\.html$/, '').replace(/^\//, ''))
  : [];
const list = [...new Set([...extra, ...pages(B)])].slice(0, MAX + extra.length);
let pagesDiff = 0;
let elemsChecked = 0;
const examples = [];
for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: mode.viewport, colorScheme: mode.colorScheme, javaScriptEnabled: false });
  await ctx.route('**/*', (r) => {
    const req = r.request();
    return req.url().startsWith('http://127.0.0.1') && !['image', 'media', 'font'].includes(req.resourceType()) ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  for (const u of list) {
    if (!fs.existsSync(path.join(A, u, 'index.html'))) { examples.push(`${mode.name} ${u}: finns inte i före`); continue; }
    await page.goto(ua + u, { waitUntil: 'load' });
    const xa = await page.evaluate(SNAP);
    await page.goto(ub + u, { waitUntil: 'load' });
    const xb = await page.evaluate(SNAP);
    if (xa.rows.length !== xb.rows.length) { pagesDiff++; examples.push(`${mode.name} ${u}: ${xa.rows.length} -> ${xb.rows.length} element`); continue; }
    let diffs = 0;
    const first = [];
    for (let i = 0; i < xa.rows.length; i++) {
      elemsChecked++;
      if (xa.rows[i] === xb.rows[i]) continue;
      const [ida, va] = xa.rows[i].split('\u0002');
      const vb = xb.rows[i].split('\u0002')[1].split('\u0001');
      va.split('\u0001').forEach((v, j) => {
        if (v !== vb[j]) { diffs++; if (first.length < 3) first.push(`${ida} ${xa.keys[j]}: ${v} -> ${vb[j]}`); }
      });
    }
    if (diffs) { pagesDiff++; examples.push(`${mode.name} ${u}: ${diffs} egenskaper skiljer; ${first.join(' | ')}`); }
  }
  await ctx.close();
}
await browser.close();
sa.close(); sb.close();
console.log(`## ${town}: ${list.length} sidor x ${MODES.length} lägen, ${elemsChecked} element jämförda, ${pagesDiff} sida/läge med skillnad`);
for (const e of examples.slice(0, 20)) console.log(`  * ${e}`);
