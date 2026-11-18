// Söker igenom dist-kopior efter VÄRDENA på alla icke-PUBLIC miljövariabler i site/.env och .env
// (astro 7-fasen, .claude/specs/astro-7.md). Skriver ALDRIG ut ett värde: bara variabelnamn + träff/ingen träff
// per fil. Söker råvärdet, JSON-escapat värde och, för URL:er med lösenord, lösenordet för sig.
//
//   node scripts/verify_no_secrets_in_dist.mjs <dist-rot eller dist> [...]
// Exit 1 vid någon träff, 0 annars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_LEN = 8;
// Söks inte. ADZUNA_APP_ID: Adzunas publika app-id, som Adzuna själva sätter som utm_source i varje annonslänk
// (redirect_url ur API:t, lagrad i DB och visad på /jobs/) -- inte hemligt. ADZUNA_APP_KEY söks fortfarande.
const ALLOW = new Set(['ADZUNA_APP_ID']);

function parseEnv(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.push([m[1], v]);
  }
  return out;
}

const vars = new Map();
for (const f of [path.join(ROOT, 'site', '.env'), path.join(ROOT, '.env')]) {
  for (const [k, v] of parseEnv(f)) if (!k.startsWith('PUBLIC_') && !ALLOW.has(k) && v) vars.set(k, v);
}
const needles = []; // { name, variant, buf }
const tooShort = [];
for (const [name, value] of vars) {
  if (value.length < MIN_LEN) { tooShort.push(name); continue; }
  const variants = new Map([['värde', value], ['json', JSON.stringify(value).slice(1, -1)], ['json-snedstreck', value.replace(/\//g, '\\/')]]);
  try {
    const u = new URL(value);
    if (u.password && decodeURIComponent(u.password).length >= MIN_LEN) variants.set('lösenord', decodeURIComponent(u.password));
    if (u.password && u.password.length >= MIN_LEN) variants.set('lösenord-kodat', u.password);
  } catch { /* inte en URL */ }
  const seen = new Set();
  for (const [variant, s] of variants) {
    if (seen.has(s)) continue;
    seen.add(s);
    needles.push({ name, variant, buf: Buffer.from(s, 'utf8') });
  }
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const roots = process.argv.slice(2);
if (!roots.length) { console.error('usage: node scripts/verify_no_secrets_in_dist.mjs <dist-rot> [...]'); process.exit(2); }
console.log(`variabler: ${[...vars.keys()].join(', ')}`);
console.log(`undantagna (allowlist): ${[...ALLOW].join(', ')}`);
if (tooShort.length) console.log(`för korta för att söka (< ${MIN_LEN} tecken): ${tooShort.join(', ')}`);
let hits = 0;
for (const r of roots) {
  let files = 0;
  const local = [];
  for (const f of walk(r)) {
    files++;
    const buf = fs.readFileSync(f);
    for (const n of needles) if (buf.includes(n.buf)) local.push(`${path.relative(r, f).replace(/\\/g, '/')}: ${n.name} (${n.variant})`);
  }
  hits += local.length;
  console.log(`${r}: ${files} filer, ${local.length ? local.length + ' TRÄFFAR' : 'ingen träff'}`);
  for (const l of local) console.log(`  TRÄFF ${l}`);
}
process.exit(hits ? 1 : 0);
