// Jämför den DOM som Chromium bygger (body.outerHTML, JavaScript avstängt) mellan två dist-kopior av samma stad
// (astro 7-fasen, .claude/specs/astro-7.md). Fångar ogiltig nästling (t.ex. <div> i <p>) som den gamla
// kompilatorn rättade men Rust-kompilatorn skickar vidare, så att webbläsaren bygger ett annat träd.
//
//   node scripts/dom_compare.mjs <före-rot> <efter-rot> <stad> [rapportfil]
//
// <rot>/<stad>/ är en hel dist. Alla .html-sidor som finns i båda. Inga underresurser hämtas.
// Två normaliserade hashar per sida:
//   struktur = bara elementträdet (taggnamn + nästling), utan text, attribut och script/style/link/meta/noscript/template
//   innehåll = body.outerHTML med asset-hashar, astro-cid, blanksteg mellan taggar och kommentarer bortnormaliserade
// Strukturskillnader listas alla, med första avvikande plats i trädet. Innehållsskillnader räknas bara
// (de domineras av datadrift och byggtidsstämplar). Exit 0 när jämförelsen gick att köra; skillnader är rapport.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'site', 'package.json'))('playwright-core');

const [beforeRoot, afterRoot, town, reportFile] = process.argv.slice(2);
if (!beforeRoot || !afterRoot || !town) { console.error('usage: node scripts/dom_compare.mjs <före-rot> <efter-rot> <stad> [rapportfil]'); process.exit(2); }
const A = path.join(beforeRoot, town);
const B = path.join(afterRoot, town);

function serve(dir) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

function htmlFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== '_astro') walk(p); }
      else if (e.name.endsWith('.html')) out.push(path.relative(dir, p).replace(/\\/g, '/'));
    }
  })(dir);
  return out.sort();
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);
// Körs i sidan: elementträdet som en rad per element ("djup tagg"), plus body.outerHTML.
const SNAP = (skip) => {
  const skipSet = new Set(skip);
  const lines = [];
  (function walk(el, depth, trail) {
    for (const c of el.children) {
      if (skipSet.has(c.tagName)) continue;
      const t = c.tagName.toLowerCase();
      lines.push(`${depth} ${t}\u0002${trail}>${t}${c.id ? '#' + c.id : c.classList[0] ? '.' + c.classList[0] : ''}`);
      walk(c, depth + 1, `${trail}>${t}`.split('>').slice(-4).join('>'));
    }
  })(document.body, 0, 'body');
  return { lines, html: document.body.outerHTML };
};

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
function normHtml(h) {
  return h
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+data-astro-cid-[a-z0-9]+(="[^"]*")?/g, '')
    .replace(/\bastro-[a-z0-9]{8}\b/g, 'astro-X')
    .replace(/\/_astro\/([^"'\s)]+?)\.[A-Za-z0-9_-]{8}\.(css|js|png|jpe?g|webp|avif|svg|woff2?)/g, '/_astro/$1.H.$2')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ');
}

const filesA = new Set(htmlFiles(A));
const filesB = htmlFiles(B);
const common = filesB.filter((f) => filesA.has(f));
const [sa, sb] = await Promise.all([serve(A), serve(B)]);
const ua = `http://127.0.0.1:${sa.address().port}/`;
const ub = `http://127.0.0.1:${sb.address().port}/`;
let browser = null;
for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) { try { browser = await chromium.launch(opts); break; } catch { /* nästa */ } }
if (!browser) { console.error('ingen webbläsare'); process.exit(2); }
const ctx = await browser.newContext({ javaScriptEnabled: false });
await ctx.route('**/*', (r) => (r.request().resourceType() === 'document' && r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));

const structDiff = [];
let contentDiff = 0;
const WORKERS = 4;
let next = 0;
async function worker() {
  const page = await ctx.newPage();
  while (next < common.length) {
    const f = common[next++];
    await page.goto(ua + f, { waitUntil: 'domcontentloaded' });
    const xa = await page.evaluate(SNAP, [...SKIP]);
    await page.goto(ub + f, { waitUntil: 'domcontentloaded' });
    const xb = await page.evaluate(SNAP, [...SKIP]);
    if (sha(normHtml(xa.html)) !== sha(normHtml(xb.html))) contentDiff++;
    const sA = xa.lines.map((l) => l.split('\u0002')[0]);
    const sB = xb.lines.map((l) => l.split('\u0002')[0]);
    if (sha(sA.join('\n')) === sha(sB.join('\n'))) continue;
    let i = 0;
    while (i < sA.length && i < sB.length && sA[i] === sB[i]) i++;
    structDiff.push({
      file: f,
      elements: `${sA.length} -> ${sB.length}`,
      at: i,
      before: (xa.lines[i] ?? '(slut)').split('\u0002')[1] ?? '(slut)',
      after: (xb.lines[i] ?? '(slut)').split('\u0002')[1] ?? '(slut)',
    });
  }
  await page.close();
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();
sa.close(); sb.close();

structDiff.sort((x, y) => x.file.localeCompare(y.file));
const out = [`## ${town}: ${common.length} sidor i båda (före ${filesA.size}, efter ${filesB.length}); struktur skiljer på ${structDiff.length}, normaliserat innehåll skiljer på ${contentDiff}`];
for (const d of structDiff) out.push(`  * ${d.file}: ${d.elements} element; första avvikelse nr ${d.at}: före ${d.before} | efter ${d.after}`);
console.log(out.join('\n'));
if (reportFile) fs.writeFileSync(reportFile, out.join('\n') + '\n');
