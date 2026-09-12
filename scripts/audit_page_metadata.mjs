#!/usr/bin/env node
/**
 * Phase 0 (blocking) of the sitewide title/H1/lede handoff -- see
 * NEEDS-HUMAN-REVIEW.md for the full spec. Reads a REAL `astro build`
 * output (same "read the actual dist/ files, don't re-derive the logic"
 * approach as verify_sitemap_noindex_disjoint.mjs -- a re-implementation
 * of what a template renders can drift from what it actually renders; the
 * built HTML can't) and emits one CSV row per route with the fields the
 * spec asks for, plus the flags that decide what Phase 1+ should target.
 *
 * NOTHING in this script changes a template. It only measures. Per the
 * spec's own "Order of work": Phase 0 audit -> config block + helper ->
 * migrate templates -> validation check LAST, once everything passes it.
 *
 * No HTML-parsing dependency exists in this codebase (no cheerio/jsdom) --
 * regex extraction over the raw markup, same convention
 * verify_sitemap_noindex_disjoint.mjs and astro.config.mjs's own
 * isThinStory()/buildLastmodMap() already use for built-output checks.
 * Astro's own output here is always well-formed (a template bug that broke
 * that would already fail `astro check`/the build itself), so this is a
 * safe simplification, not a fragile shortcut -- same reasoning those
 * files already established.
 *
 * Usage: node scripts/audit_page_metadata.mjs <dist-dir> <town_id>
 * Writes reports/metadata-audit-<town_id>.csv, creating reports/ if needed.
 * Always exits 0 -- this is a measurement tool, not a gate (the spec's own
 * page_meta_check, added in a LATER phase once templates are migrated, is
 * the thing that fails the build).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { globSync } from 'node:fs';

const distDir = process.argv[2];
const townId = process.argv[3];
if (!distDir || !townId) {
  console.error('Usage: node scripts/audit_page_metadata.mjs <dist-dir> <town_id>');
  process.exit(2);
}

// --- extraction -------------------------------------------------------

function extractTag(html, tagRe) {
  const m = html.match(tagRe);
  return m ? m[1].trim() : null;
}

/** Strips markup down to plain text for word/char counting -- entities
 *  decoded just enough to not inflate counts (&amp; etc. would otherwise
 *  count as several "words"/many chars they visually aren't). */
function stripTags(fragment) {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&rarr;/g, '->').replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Normalized token overlap (Jaccard) between title and H1 -- lowercase,
 *  strip punctuation, split on whitespace, compare as SETS (not
 *  multisets): the spec's own worry is "saying the same thing twice," a
 *  set-overlap question, not a word-frequency one. */
function tokenSet(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean),
  );
}
function jaccardSimilarity(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function auditRoute(route, html) {
  const title = stripTags(extractTag(html, /<title>([\s\S]*?)<\/title>/) ?? '');
  const metaDescription = extractTag(
    html, /<meta\s+name="description"\s+content="([^"]*)"/,
  ) ?? '';
  const isNoindex = /<meta\s+name="robots"\s+content="noindex/i.test(html);

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const main = mainMatch ? mainMatch[1] : '';

  const h1Matches = [...main.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  // Fall back to whole-document H1 count too -- a page whose only H1 sits
  // OUTSIDE <main> (shouldn't happen, but the count should say so plainly
  // rather than silently reporting "zero" as if none exists at all).
  const h1CountWholeDoc = [...html.matchAll(/<h1[^>]*>/g)].length;
  const h1 = h1Matches.length > 0 ? stripTags(h1Matches[0][1]) : '';

  const pMatches = [...main.matchAll(/<p( [^>]*)?>([\s\S]*?)<\/p>/g)];
  // Literal per the spec: the first <p> in <main>, whatever it is.
  const ledeLiteral = pMatches.length > 0 ? stripTags(pMatches[0][2]) : '';
  // Diagnostic addition, not a spec field: the first <p> that is neither an
  // ImageAttribution credit line NOR one of this codebase's own small-
  // metadata paragraphs -- found live auditing /city-hall/ (the literal
  // first <p> is a photo credit) AND /facilities/[slug]/ (the literal first
  // <p> is a "kind" category kicker, e.g. "Fire stations", rendered before
  // the <h1> even) AND every meeting/event/alert /s/[slug]/ page (a
  // "story__kind"/"story__when" kicker+date line rendered before the real
  // body). All of these -- and dozens of other unrelated components
  // (dates, prices, temperatures, "kind" labels) -- already share ONE real,
  // sitewide convention: a `data` class token marks small metadata text,
  // never editorial content (confirmed: "story__kind data", "kind data",
  // "card__date data", "forecast__temp data", etc. all over site/src). A
  // single principled exclusion on that token, not a growing blocklist of
  // specific component class names that would need updating every time a
  // new one is found. image-attribution doesn't use the `data` convention,
  // so it's excluded separately.
  const isMetaParagraph = (attrString) => {
    const classMatch = (attrString ?? '').match(/class="([^"]*)"/);
    if (!classMatch) return false;
    const classes = classMatch[1].split(/\s+/);
    return classes.includes('data') || classes.includes('image-attribution');
  };
  const firstNonMetaP = pMatches.find((m) => !isMetaParagraph(m[1]));
  const ledeExclMeta = firstNonMetaP ? stripTags(firstNonMetaP[2]) : '';

  const titleH1Similarity = title && h1 ? jaccardSimilarity(title, h1) : 0;

  return {
    route,
    title, titleChars: title.length,
    h1, h1Chars: h1.length, h1Count: h1CountWholeDoc,
    ledeLiteral, ledeLiteralWords: wordCount(ledeLiteral),
    ledeExclMeta, ledeExclMetaWords: wordCount(ledeExclMeta),
    ledeDiffersFromLiteral: ledeLiteral !== ledeExclMeta,
    metaDescription, metaDescriptionChars: metaDescription.length,
    isNoindex,
    titleH1Similarity: Number(titleH1Similarity.toFixed(3)),
  };
}

// --- flags (per-row + cross-row) ---------------------------------------

function flagsForRow(row) {
  const flags = [];
  if (row.title) {
    if (row.titleChars > 60) flags.push('title>60chars');
    if (row.titleChars < 30) flags.push('title<30chars');
  } else {
    flags.push('title-missing');
  }
  if (row.h1) {
    if (wordCount(row.h1) < 4) flags.push('h1<4words');
  } else {
    flags.push('h1-missing');
  }
  if (row.h1Count === 0) flags.push('h1-count-zero');
  if (row.h1Count > 1) flags.push('h1-count-multiple');
  if (row.titleH1Similarity > 0.8) flags.push('title-h1-too-similar');
  // Lede rules only meaningfully apply to indexable pages -- the spec's
  // own per-page-type table says noindexed detail pages skip the title
  // uniqueness check but keep H1/lede rules, so lede<20words is still
  // flagged there too, not suppressed by isNoindex.
  if (!row.ledeExclMeta) flags.push('lede-missing');
  else if (row.ledeExclMetaWords < 20) flags.push('lede<20words');
  if (row.metaDescription) {
    if (row.metaDescriptionChars > 155) flags.push('meta-description>155chars');
    if (row.metaDescriptionChars < 70) flags.push('meta-description<70chars');
  } else {
    flags.push('meta-description-missing');
  }
  return flags;
}

// --- walk dist/ ----------------------------------------------------------

const pattern = join(distDir, '**', 'index.html').split(sep).join('/');
const files = globSync(pattern);

// Owner follow-up: reweight "which routes matter" from "every indexable-
// looking route" to "routes actually in the sitemap" -- a route can carry
// no noindex meta tag and still never reach a reader via search (thin-tag
// pages, cross-site-canonical non-origin copies, town-gated redirect
// stubs -- see astro.config.mjs's own filter()) precisely because the
// sitemap's OWN exclusion rules already encode "can this realistically
// rank" more precisely than isNoindex alone does. Reads the real built
// sitemap-index.xml -> sitemap-N.xml chain (same "read the actual dist/
// output" convention as verify_sitemap_noindex_disjoint.mjs) rather than
// re-deriving astro.config.mjs's filter logic a third time -- a
// re-implementation could drift; the built XML can't.
function loadSitemapPathnames(dir) {
  const indexPath = join(dir, 'sitemap-index.xml');
  let indexXml;
  try {
    indexXml = readFileSync(indexPath, 'utf-8');
  } catch {
    console.error(`Warning: no sitemap-index.xml at ${indexPath} -- inSitemap will be false for every route.`);
    return new Set();
  }
  const subSitemapUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pathnames = new Set();
  for (const subUrl of subSitemapUrls) {
    const subPath = join(dir, new URL(subUrl).pathname.split('/').pop());
    const subXml = readFileSync(subPath, 'utf-8');
    for (const m of subXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      pathnames.add(new URL(m[1]).pathname);
    }
  }
  return pathnames;
}
const sitemapPathnames = loadSitemapPathnames(distDir);

const rows = [];
for (const file of files) {
  const rel = relative(distDir, file).split(sep).join('/');
  const route = '/' + rel.replace(/index\.html$/, '');
  const html = readFileSync(file, 'utf-8');
  const normalizedRoute = route === '/index.html' ? '/' : route;
  const row = auditRoute(normalizedRoute, html);
  row.inSitemap = sitemapPathnames.has(normalizedRoute);
  rows.push(row);
}

// Cross-row: duplicate title/H1 across two INDEXABLE routes in this town.
const titleOwners = new Map();
const h1Owners = new Map();
for (const row of rows) {
  if (row.isNoindex) continue;
  if (row.title) {
    if (!titleOwners.has(row.title)) titleOwners.set(row.title, []);
    titleOwners.get(row.title).push(row.route);
  }
  if (row.h1) {
    if (!h1Owners.has(row.h1)) h1Owners.set(row.h1, []);
    h1Owners.get(row.h1).push(row.route);
  }
}
const duplicateTitles = new Set(
  [...titleOwners.entries()].filter(([, routes]) => routes.length > 1).map(([t]) => t),
);
const duplicateH1s = new Set(
  [...h1Owners.entries()].filter(([, routes]) => routes.length > 1).map(([h]) => h),
);

for (const row of rows) {
  const flags = flagsForRow(row);
  if (!row.isNoindex && row.title && duplicateTitles.has(row.title)) flags.push('title-duplicated');
  if (!row.isNoindex && row.h1 && duplicateH1s.has(row.h1)) flags.push('h1-duplicated');
  row.flags = flags.join(';');
}

// --- CSV output ----------------------------------------------------------

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const columns = [
  'route', 'inSitemap', 'isNoindex', 'title', 'titleChars', 'h1', 'h1Chars', 'h1Count',
  'titleH1Similarity', 'ledeLiteral', 'ledeLiteralWords', 'ledeExclMeta',
  'ledeExclMetaWords', 'ledeDiffersFromLiteral', 'metaDescription',
  'metaDescriptionChars', 'flags',
];
const lines = [columns.join(',')];
for (const row of rows) {
  lines.push(columns.map((c) => csvEscape(row[c])).join(','));
}

mkdirSync('reports', { recursive: true });
const outPath = `reports/metadata-audit-${townId}.csv`;
writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');

const inSitemapRows = rows.filter((r) => r.inSitemap);
const flaggedCount = rows.filter((r) => r.flags).length;
const flaggedInSitemapCount = inSitemapRows.filter((r) => r.flags).length;
console.log(
  `[${townId}] audited ${rows.length} route(s), ${flaggedCount} with at least one flag ` +
  `(${inSitemapRows.length} routes in sitemap, ${flaggedInSitemapCount} of those flagged) -- wrote ${outPath}`,
);
