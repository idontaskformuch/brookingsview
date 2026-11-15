#!/usr/bin/env node
/**
 * Daily snapshot of what the LIVE site tells search engines (owner 2026-11-15, part 3 option A of
 * .claude/notes/data-driven-robots-inventory-2026-11-15.md): the sitemap and the robots tag of every page whose tag or sitemap place
 * depends on data at build time, plus the state files the builds read back. Run once a day by qa-daily (job index-snapshot) and kept as an
 * artifact, so the next inventory can count each page's switches per town instead of guessing.
 *
 * Glasgow: only the sitemap and the addresses already let through Glasgow's Cloudflare challenge (/tonight/, /evening-state.json); nothing
 * else is read there. Every address is read once, with the builds' own user agent; a failed read is recorded as such, never retried another
 * way. The snapshot is data, not a gate: the script exits 0 unless it cannot write its file.
 *
 * Usage: node scripts/snapshot_live_index.mjs --town <town_id> [--out file]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const town = arg('--town');
if (!town) { console.error('Usage: node scripts/snapshot_live_index.mjs --town <town_id> [--out file]'); process.exit(2); }
const out = arg('--out') ?? join(ROOT, 'qa', 'out', `index-snapshot-${town}.json`);
const domain = JSON.parse(readFileSync(join(ROOT, 'configs', `${town}.json`), 'utf8')).domain;
const base = `https://${domain}`;

/** Data-driven pages (inventory 2026-11-15). Every other data-driven page type (/this-week/, /month/, projects, facilities, /s/, home-sales
 *  ZIPs) is many URLs whose index state is its sitemap membership (scripts/verify_sitemap_noindex_disjoint.mjs keeps the two equal). */
export const SNAPSHOT = {
  default: {
    sitemap: ['/sitemap-index.xml'],
    pages: ['/tonight/', '/this-weekend/', '/traffic/', '/open-late/', '/today/'],
    states: ['/evening-state.json', '/traffic-state.json'],
  },
  glasgow: { sitemap: ['/sitemap-0.xml'], pages: ['/tonight/'], states: ['/evening-state.json'] },
};
const plan = SNAPSHOT[town] ?? SNAPSHOT.default;
const HEADERS = { 'user-agent': 'ViewMediaBuild/1.0' };

async function get(path) {
  try {
    const res = await fetch(new URL(path, base), { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return { status: res.status, location: res.headers.get('location'), body: res.status === 200 ? await res.text() : null };
  } catch (e) { return { status: null, error: e instanceof Error ? e.name : 'error', body: null }; }
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const robots = (html) => html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1] ?? null;

const snap = { town, base, at: new Date().toISOString(), sitemap: { files: {}, urls: [] }, pages: {}, states: {} };
for (const path of plan.sitemap) {
  const r = await get(path);
  snap.sitemap.files[path] = r.status;
  if (!r.body) continue;
  const found = locs(r.body);
  if (r.body.includes('<sitemapindex')) {
    // An index lists the town's own sitemap files; read each once.
    for (const child of found) {
      const c = await get(new URL(child).pathname);
      snap.sitemap.files[new URL(child).pathname] = c.status;
      if (c.body) snap.sitemap.urls.push(...locs(c.body).map((u) => new URL(u).pathname));
    }
  } else snap.sitemap.urls.push(...found.map((u) => new URL(u).pathname));
}
snap.sitemap.urls.sort();
for (const path of plan.pages) {
  const r = await get(path);
  snap.pages[path] = { status: r.status, ...(r.location ? { location: r.location } : {}), ...(r.error ? { error: r.error } : {}),
    robots: r.body ? robots(r.body) : null, inSitemap: snap.sitemap.urls.includes(path) };
}
for (const path of plan.states) {
  const r = await get(path);
  let value = null;
  try { value = r.body ? JSON.parse(r.body) : null; } catch { value = 'unparsable'; }
  snap.states[path] = { status: r.status, value };
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap, null, 2));
const failed = [...Object.entries(snap.sitemap.files), ...Object.entries(snap.pages).map(([p, v]) => [p, v.status])]
  .filter(([, s]) => s !== 200 && s !== 404 && !(s >= 300 && s < 400));
console.log(`[index-snapshot] ${town}: ${snap.sitemap.urls.length} sitemap URLs; `
  + Object.entries(snap.pages).map(([p, v]) => `${p} ${v.status}${v.robots ? ` "${v.robots}"` : ''}${v.inSitemap ? ' (sitemap)' : ''}`).join('; '));
if (failed.length) console.log(`[index-snapshot] ${town}: not readable: ${failed.map(([p, s]) => `${p} ${s}`).join(', ')}`);
