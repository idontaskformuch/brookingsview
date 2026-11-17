// Jämför två dist-kopior per stad (astro-uppgraderingen, .claude/specs/astro-7.md).
//
//   node scripts/dist_compare.mjs <före-rot> <efter-rot> [rapportkatalog] [stad ...]
//
// <rot>/<stad>/ är en hel dist (battery.sh med DIST_SNAPSHOT=<rot>). Standard: alla fyra städer.
// Normaliserar bort: asset-hashar i filnamn och referenser (Name.AbC12345.js -> Name.[h].js),
// Astros scoping-hashar (data-astro-cid-*, astro-xxxxxxxx), build-sha och data-built-at.
// Rapporterar per stad: tillkomna/försvunna filer, HTML-sidor med ändrat innehåll
// (uppdelat i "bara blanksteg" och "innehåll", antal + exempel med första skillnaden),
// övriga textfiler, OG-bilder med pixeldiff (sharp), och byggets interna JS (bara antal).
// Exit 0 alltid när jämförelsen gick att köra; skillnader är rapport, inte fel.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(ROOT, 'site', 'package.json'))('sharp');

const [beforeRoot, afterRoot, outDirArg, ...townArgs] = process.argv.slice(2);
if (!beforeRoot || !afterRoot) {
  console.error('usage: node scripts/dist_compare.mjs <före-rot> <efter-rot> [rapportkatalog] [stad ...]');
  process.exit(2);
}
const TOWNS = townArgs.length ? townArgs : ['brookings_sd', 'moreno_valley_ca', 'broomfield_co', 'glasgow'];
const outDir = path.resolve(outDirArg ?? path.join(ROOT, 'scratch_tmp', 'dist-compare'));
fs.mkdirSync(outDir, { recursive: true });

const EXAMPLES = 8;
const HASH = /([A-Za-z0-9_$@-]+?)[._-]([A-Za-z0-9_-]{8})\.(m?js|css|map|woff2?|ttf|svg|png|jpe?g|webp|avif)\b/g;
// Byggets interna server-/prerender-bitar: jämförs bara som antal (byter form mellan Vite-versioner).
const INTERNAL = (rel) => /^(chunks|pages)\//.test(rel) || /^[^/]+\.mjs$/.test(rel) || /^_astro\/.*\.(m?js|map)$/.test(rel);

export function normalizePath(rel) {
  return rel.replace(/\\/g, '/').replace(HASH, '$1.[h].$3');
}

export function normalizeText(s) {
  return s
    .replace(HASH, '$1.[h].$3')
    .replace(/data-astro-cid-[a-z0-9]+(="[^"]*")?/g, 'data-astro-cid')
    .replace(/\bastro-[a-z0-9]{8}\b/g, 'astro-cid')
    .replace(/(<meta name="build-sha" content=")[^"]*/g, '$1X')
    .replace(/(<meta name="data-built-at" content=")[^"]*/g, '$1X');
}

const squash = (s) => s.replace(/\s+/g, '');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

function index(dir) {
  const m = new Map();
  for (const rel of walk(dir)) {
    const key = normalizePath(rel);
    if (m.has(key)) m.set(key + ' #' + rel, rel); // två filer som bara skiljer i hash
    else m.set(key, rel);
  }
  return m;
}

function firstDiff(a, b, ctx = 90) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - ctx);
  const one = (s) => s.slice(from, i + ctx).replace(/\s+/g, ' ');
  return { at: i, before: one(a), after: one(b) };
}

async function pixelDiff(fa, fb) {
  const [a, b] = await Promise.all([fa, fb].map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { sizeChanged: `${a.info.width}x${a.info.height} -> ${b.info.width}x${b.info.height}`, pct: 100 };
  }
  let diff = 0;
  const n = a.info.width * a.info.height;
  for (let p = 0; p < n * 4; p += 4) {
    if (Math.abs(a.data[p] - b.data[p]) > 8 || Math.abs(a.data[p + 1] - b.data[p + 1]) > 8
      || Math.abs(a.data[p + 2] - b.data[p + 2]) > 8 || Math.abs(a.data[p + 3] - b.data[p + 3]) > 8) diff++;
  }
  return { pct: +(100 * diff / n).toFixed(3), pixels: diff };
}

async function compareTown(town) {
  const A = path.join(beforeRoot, town);
  const B = path.join(afterRoot, town);
  if (!fs.existsSync(A) || !fs.existsSync(B)) return { town, missing: [A, B].filter((d) => !fs.existsSync(d)) };
  const ia = index(A);
  const ib = index(B);
  const r = {
    town, filesBefore: ia.size, filesAfter: ib.size,
    added: [], removed: [], html: { same: 0, whitespaceOnly: [], content: [] },
    text: { same: 0, changed: [] }, og: { same: 0, changed: [] }, binary: { same: 0, changed: [] },
    internal: { before: 0, after: 0 },
  };
  for (const [k, rel] of ia) if (INTERNAL(rel)) r.internal.before++;
  for (const [k, rel] of ib) if (INTERNAL(rel)) r.internal.after++;
  for (const [k, rel] of ia) if (!ib.has(k) && !INTERNAL(rel)) r.removed.push(rel);
  for (const [k, rel] of ib) if (!ia.has(k) && !INTERNAL(rel)) r.added.push(rel);

  for (const [k, relA] of ia) {
    const relB = ib.get(k);
    if (!relB || INTERNAL(relA)) continue;
    const fa = path.join(A, relA);
    const fb = path.join(B, relB);
    const ext = path.extname(relA).toLowerCase();
    if (ext === '.png' && relA.startsWith('og/')) {
      const ba = fs.readFileSync(fa);
      const bb = fs.readFileSync(fb);
      if (ba.equals(bb)) { r.og.same++; continue; }
      const d = await pixelDiff(fa, fb);
      if (d.pct === 0) r.og.same++;
      else r.og.changed.push({ file: relA, ...d });
      continue;
    }
    if (/\.(html|css|xml|txt|json|webmanifest|ics|svg|js)$/.test(ext)) {
      const ta = normalizeText(fs.readFileSync(fa, 'utf8'));
      const tb = normalizeText(fs.readFileSync(fb, 'utf8'));
      if (ta === tb) { ext === '.html' ? r.html.same++ : r.text.same++; continue; }
      if (ext === '.html') {
        if (squash(ta) === squash(tb)) r.html.whitespaceOnly.push({ file: relA, ...firstDiff(ta, tb) });
        else r.html.content.push({ file: relA, ...firstDiff(ta, tb) });
      } else r.text.changed.push({ file: relA, ...firstDiff(ta, tb) });
      continue;
    }
    if (fs.readFileSync(fa).equals(fs.readFileSync(fb))) r.binary.same++;
    else r.binary.changed.push({ file: relA });
  }
  r.og.changed.sort((x, y) => y.pct - x.pct);
  return r;
}

function printTown(r) {
  const L = [];
  if (r.missing) { L.push(`## ${r.town}: SAKNAS ${r.missing.join(', ')}`); return L; }
  L.push(`## ${r.town}`);
  L.push(`filer ${r.filesBefore} -> ${r.filesAfter} (byggets interna JS ${r.internal.before} -> ${r.internal.after}, jämförs inte)`);
  L.push(`tillkomna ${r.added.length}, försvunna ${r.removed.length}`);
  for (const f of r.added.slice(0, EXAMPLES)) L.push(`  + ${f}`);
  for (const f of r.removed.slice(0, EXAMPLES)) L.push(`  - ${f}`);
  L.push(`HTML: ${r.html.same} lika, ${r.html.whitespaceOnly.length} bara blanksteg (granskas: "a <b>b</b>" -> "a<b>b</b>" hamnar här), ${r.html.content.length} ändrat innehåll`);
  for (const d of [...r.html.content.slice(0, EXAMPLES), ...r.html.whitespaceOnly.slice(0, 3)]) {
    L.push(`  * ${d.file} @${d.at}`);
    L.push(`      före:  ${d.before}`);
    L.push(`      efter: ${d.after}`);
  }
  L.push(`övriga textfiler: ${r.text.same} lika, ${r.text.changed.length} ändrade`);
  for (const d of r.text.changed.slice(0, EXAMPLES)) L.push(`  * ${d.file} @${d.at}: ${d.before.slice(60, 140)} => ${d.after.slice(60, 140)}`);
  L.push(`OG-bilder: ${r.og.same} lika, ${r.og.changed.length} ändrade`);
  for (const d of r.og.changed.slice(0, EXAMPLES)) L.push(`  * ${d.file}: ${d.sizeChanged ?? d.pct + ' % pixlar'}`);
  L.push(`övriga binärer: ${r.binary.same} lika, ${r.binary.changed.length} ändrade`);
  for (const d of r.binary.changed.slice(0, EXAMPLES)) L.push(`  * ${d.file}`);
  return L;
}

const results = [];
for (const t of TOWNS) results.push(await compareTown(t));
const lines = [`# dist-jämförelse ${beforeRoot} -> ${afterRoot}`, ''];
for (const r of results) lines.push(...printTown(r), '');
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
console.log(lines.join('\n'));
console.log(`fullständig lista: ${path.join(outDir, 'report.json')}`);
