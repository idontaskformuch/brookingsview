#!/usr/bin/env node
/**
 * QA build.local-images (astro 6-uppgraderingen 2026-11-18, .claude/specs/astro-7.md session 2).
 * images.ts löste site/public relativt den buntade modulen; under astro 6 (dist/.prerender/chunks/) pekade det på
 * site/dist/public, så varje lokal bild räknades som saknad och sidorna föll TYST tillbaka (bara assertImageExists
 * kraschade bygget). Kontrollen: har site/public lokala bilder som stadens sidor väljer (kategoribilder för staden),
 * måste stadens dist referera till minst en /assets/images/-fil som finns i site/public. Annars exit 1.
 * (Ägarens ursprungliga formulering gällde 4x3/1x1-beskärningar; de används inte av någon publicerad sida sedan
 * innehållsspåren togs bort i Fas 13c -- 0 referenser redan på main -- så kontrollen räknar lokala bilder i stället.)
 *
 * Usage: node scripts/verify_local_images.mjs <dist-dir> <town_id>   (town_id defaults to $SITE_CITY)
 * Bara brookings_sd, moreno_valley_ca, broomfield_co kontrolleras; övriga städer hoppas över.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOWNS = new Set(['brookings_sd', 'moreno_valley_ca', 'broomfield_co']);
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public');

const dist = process.argv[2];
const town = process.argv[3] ?? process.env.SITE_CITY;
if (!dist || !town) { console.error('Usage: node scripts/verify_local_images.mjs <dist-dir> <town_id>'); process.exit(2); }
if (!TOWNS.has(town)) { console.log(`verify_local_images: ok (${town} kontrolleras inte)`); process.exit(0); }

const catDir = join(PUBLIC, 'assets', 'images', 'categories');
const available = existsSync(catDir) ? readdirSync(catDir).filter((f) => f.startsWith(`${town}-`) && f.endsWith('.png')) : [];
if (!available.length) { console.log(`verify_local_images: ok (${town}: inga kategoribilder i site/public)`); process.exit(0); }

function* html(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* html(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

const refs = new Set();
for (const f of html(dist)) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\/assets\/images\/[^"'\s)?#]+/g)) refs.add(m[0]);
}
const onDisk = [...refs].filter((r) => existsSync(join(PUBLIC, r)));
if (!onDisk.length) {
  console.error(`verify_local_images: ${town} har ${available.length} kategoribilder i site/public men dist refererar till 0 lokala bilder `
    + `(${refs.size} /assets/images/-referenser, ingen finns på disk) -- images.ts hittar inte public/?`);
  process.exit(1);
}
console.log(`verify_local_images: ok (${town}: ${onDisk.length} lokala bilder refererade)`);
