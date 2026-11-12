/** The main menu and the footer link only to pages a reader can land on (Broomfield AdSense plan F3, 2026-11-12): broomfieldview.com's
 *  first tab was /today/, a noindex page that said "Turn on JavaScript", and /this-week/ was a redirect stub. Whether a page is
 *  indexable is decided by the page itself at build time (DB data), so the rule runs on the finished build: astro.config.mjs calls
 *  pruneNavInDist() after the build, which follows redirect stubs to their target and drops every nav/footer entry whose target is
 *  missing or carries noindex. scripts/verify_nav_links.mjs checks the result.
 *
 *  Only the towns listed here (other towns keep their nav unchanged until the owner says otherwise). */
import fs from 'node:fs';
import path from 'node:path';

export const NAV_ONLY_INDEXABLE_TOWNS = new Set(['broomfield_co']);

const REFRESH_RE = /<meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']/i;
const NOINDEX_RE = /<meta\s+name="robots"\s+content="noindex/i;
const ORIGIN = 'https://site.internal';

/** The file a site path is served from in `root`, or null. '/x/' -> x/index.html, '/rss.xml' -> rss.xml. */
export function distFileFor(root, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidates = rel === '' || rel.endsWith('/') ? [path.join(root, rel, 'index.html')] : [path.join(root, rel), path.join(root, rel, 'index.html')];
  return candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null;
}

/** Reads a built page for resolveNavTarget: its HTML, '' for a non-HTML file, null when nothing is served at that path. */
export function distReader(root) {
  return (pathname) => {
    const file = distFileFor(root, pathname);
    if (!file) return null;
    return file.endsWith('.html') ? fs.readFileSync(file, 'utf8') : '';
  };
}

/** Where an internal href ends up. Follows redirect stubs (at most 5); `href` is the final path.
 *  ok=false with reason 'missing' | 'noindex' | 'redirect-loop' | 'off-site'. A link that is not a site path is ok as it is. */
export function resolveNavTarget(href, readPage) {
  if (!href.startsWith('/') || href.startsWith('//')) return { ok: true, href };
  let pathname = new URL(href, ORIGIN).pathname;
  for (let hop = 0; hop <= 5; hop++) {
    const html = readPage(pathname);
    if (html === null) return { ok: false, href: pathname, reason: 'missing' };
    const refresh = html.match(REFRESH_RE);
    if (refresh) {
      const next = new URL(refresh[1], ORIGIN + pathname);
      if (next.origin !== ORIGIN) return { ok: false, href: pathname, reason: 'off-site' };
      pathname = next.pathname;
      continue;
    }
    if (NOINDEX_RE.test(html)) return { ok: false, href: pathname, reason: 'noindex' };
    return { ok: true, href: pathname };
  }
  return { ok: false, href: pathname, reason: 'redirect-loop' };
}

// A nav entry: an <a data-nav-id> (tab row), optionally wrapped in its own <li> (All sheet, footer).
const ENTRY_RE = /(<li\b[^>]*>\s*)?<a\b([^>]*\bdata-nav-id="[^"]*"[^>]*)>([\s\S]*?)<\/a>(\s*<\/li>)?/g;
// Group titles are plain text ([^<]*), so a match can never run on into the next group.
const EMPTY_GROUP_RES = [
  /<section\b[^>]*class="snav__group"[^>]*>\s*<h3\b[^>]*>[^<]*<\/h3>\s*<ul\b[^>]*>\s*<\/ul>\s*<\/section>/g,
  /<div\b[^>]*class="colophon__group"[^>]*>\s*<p\b[^>]*>[^<]*<\/p>\s*<ul\b[^>]*>\s*<\/ul>\s*<\/div>/g,
];

/** Drops the nav entries whose target `resolve(href)` rejects, points the rest at their final path, and drops groups left empty. */
export function pruneNav(html, resolve) {
  const removed = [];
  const rewritten = [];
  let out = html.replace(ENTRY_RE, (whole, liOpen, attrs, label, liClose) => {
    const href = attrs.match(/\bhref="([^"]*)"/)?.[1];
    if (href === undefined) return whole;
    const target = resolve(href);
    if (!target.ok) {
      removed.push({ href, reason: target.reason });
      // An <li> that wraps only this link goes with it; a lone half (never emitted today) is left alone.
      return liOpen && liClose ? '' : (liOpen ?? '') + (liClose ?? '');
    }
    if (target.href === href) return whole;
    rewritten.push({ from: href, to: target.href });
    return whole.replace(`href="${href}"`, `href="${target.href}"`);
  });
  for (const re of EMPTY_GROUP_RES) out = out.replace(re, '');
  return { html: out, removed, rewritten };
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

/** Runs pruneNav over every page of a finished build. Returns what was dropped/rewritten (unique hrefs) for the build log. */
export function pruneNavInDist(root) {
  const readPage = distReader(root);
  const cache = new Map();
  const resolve = (href) => {
    if (!cache.has(href)) cache.set(href, resolveNavTarget(href, readPage));
    return cache.get(href);
  };
  // Resolve against the build as it was, before any page is rewritten.
  const files = htmlFiles(root);
  const removed = new Map();
  const rewritten = new Map();
  const changed = [];
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const res = pruneNav(html, resolve);
    for (const r of res.removed) removed.set(r.href, r.reason);
    for (const r of res.rewritten) rewritten.set(r.from, r.to);
    if (res.html !== html) changed.push([file, res.html]);
  }
  for (const [file, html] of changed) fs.writeFileSync(file, html);
  return { removed: [...removed].map(([href, reason]) => ({ href, reason })), rewritten: [...rewritten].map(([from, to]) => ({ from, to })) };
}
