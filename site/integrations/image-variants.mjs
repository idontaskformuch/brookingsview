// Responsive WebP variants of the photo pools (spec full-pages-no-ai-prose Fas 1a, 2026-11-18) and the dead-image-URL build check.
// Pages reference /assets/images/{this-week,holidays}/<id>-<640|960|1200>.webp (lib/city-face.ts responsiveSrc); only the files a page
// actually references are made, from the pool's own JPG in site/public, so a build converts a handful of photos, not the whole pool.
//   build: astro:build:done writes them into dist, then fails the build when any /assets/images/ URL in the HTML has no file in dist.
//   dev:   a middleware answers the same URLs from memory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const VARIANT_URL = /\/assets\/images\/(this-week|holidays)\/([a-z0-9_-]+)-(640|960|1200)\.webp/g;
const IMAGE_URL = /\/assets\/images\/[^"'\s)?#,&<>]+/g;

/** The WebP bytes of one variant, or null when the source JPG does not exist. */
export async function makeVariant(publicDir, dir, name, width) {
  const src = path.join(publicDir, 'assets', 'images', dir, `${name}.jpg`);
  if (!fs.existsSync(src)) return null;
  return sharp(src).resize({ width: Number(width), withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}

function* htmlFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

/** Every /assets/images/ URL in the built HTML -> one page that references it. */
export function imageRefs(outDir) {
  const refs = new Map();
  for (const f of htmlFiles(outDir)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(IMAGE_URL)) if (!refs.has(m[0])) refs.set(m[0], path.relative(outDir, f));
  }
  return refs;
}

/** Writes the referenced variants into outDir; returns the URLs whose file is still missing afterwards (dead image URLs). */
export async function buildVariantsAndCheck(outDir, publicDir) {
  const refs = imageRefs(outDir);
  for (const url of refs.keys()) {
    const m = [...url.matchAll(VARIANT_URL)][0];
    if (!m || m[0] !== url) continue;
    const target = path.join(outDir, url);
    if (fs.existsSync(target)) continue;
    const buf = await makeVariant(publicDir, m[1], m[2], m[3]);
    if (!buf) continue; // reported as dead below
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  return [...refs].filter(([url]) => !fs.existsSync(path.join(outDir, url))).map(([url, page]) => `${url} (${page})`);
}

export default function imageVariants() {
  let publicDir;
  return {
    name: 'image-variants',
    hooks: {
      'astro:config:done': ({ config }) => { publicDir = fileURLToPath(config.publicDir); },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          const m = [...(req.url ?? '').split('?')[0].matchAll(VARIANT_URL)][0];
          if (!m || m[0] !== req.url.split('?')[0]) return next();
          const buf = await makeVariant(publicDir, m[1], m[2], m[3]);
          if (!buf) return next();
          res.setHeader('Content-Type', 'image/webp');
          res.end(buf);
        });
      },
      'astro:build:done': async ({ dir }) => {
        const dead = await buildVariantsAndCheck(fileURLToPath(dir), publicDir);
        if (dead.length > 0) {
          throw new Error(`image-variants: ${dead.length} image URL(s) in the built pages have no file (QA build.no-dead-image-urls):\n  ${dead.slice(0, 20).join('\n  ')}`);
        }
      },
    },
  };
}
