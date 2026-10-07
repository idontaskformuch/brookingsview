import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Statiskt bygge: all data hämtas från Neon vid build-time, sedan serveras rena
// HTML-filer från Cloudflares edge. GitHub Actions pingar deploy-hooken efter
// varje scrape+publish-körning, så innehållet är som mest en timme gammalt.
//
// site: väljs per SITE_CITY, samma variabel som site/src/lib/site-config.ts
// läser. Utelämnad -> Brookings, så befintliga byggen är oförändrade.
const SITE_URLS = {
  brookings_sd: 'https://brookingsview.com',
  moreno_valley_ca: 'https://morenovalleyview.com',
  broomfield_co: 'https://broomfieldview.com',
};

// astro.config.mjs itself loads BEFORE Vite's own env pipeline populates
// import.meta.env (that's how lib/db.ts normally reads DATABASE_URL) --
// confirmed live: a plain `process.env.DATABASE_URL` read here is empty
// even in a local build that has a real `.env`, and CI sets DATABASE_URL
// as a real process env var on the build step regardless (see scrape.yml),
// so this only matters for local verification -- but the fallback matters
// there too. loadEnv() is Vite's own documented way to read `.env` from
// inside a config file specifically because of this timing gap.
const env = { ...loadEnv('', process.cwd(), ''), ...process.env };
const activeCity = env.SITE_CITY ?? 'brookings_sd';

// Local Accent Identity. Mirrors site-config.ts's per-town `brand` field
// exactly -- same duplication tradeoff as slugifyAddress/extractZip/
// slugifyCategory below: site-config.ts reads import.meta.env.SITE_CITY at
// module scope, which isn't available yet when this file evaluates, so it
// can't be imported directly here. Keep both in sync by hand.
const BRAND_TOKENS = {
  brookings_sd: { accent: '#746311', accentInk: '#473d0a' },
  moreno_valley_ca: { accent: '#4f6b2e', accentInk: '#38491f' },
  broomfield_co: { accent: '#2d7980', accentInk: '#124549' },
};

// Emits the per-town accent tokens as ONE plain static asset in publicDir
// (copied verbatim to dist/, no bundling/hashing, same stable URL
// "/accent-tokens.css" on every build of every town) rather than inlining
// them into BaseLayout.astro's own <style> block. This site has no single
// shared CSS file today -- Astro bundles/inlines each page's styles into
// its own per-page chunk (confirmed live: dist/_astro/*.css hashes differ
// per page, and small bundles get inlined into the page's own <head>
// entirely) -- so a change inside BaseLayout's <style> block changes either
// the raw HTML (if inlined) or the linked chunk's hash (if external) on
// EVERY page, in EVERY town, on every build from then on. A real prior
// incident (two same-day shared-code deploys that touched already-
// published pages triggered a simultaneous Google re-crawl queue across two
// towns, producing an indexing backlog that took weeks to clear) is exactly
// what this avoids for ongoing tuning: once the one <link> tag referencing
// this stable URL ships, only this file's CONTENT changes when a color is
// picked or tuned later -- no town's HTML changes again for that.
// A town with no brand override still gets a real file, explicitly pinned
// to the existing shared navy (#0b2e55) -- not an absent file relying
// solely on BaseLayout's own inline var() fallback -- so "no brand block"
// is a visible, checked-in fallback rather than an implicit one.
const brand = BRAND_TOKENS[activeCity];
const accentTokensCss = brand
  ? `:root {\n  --brand-accent: ${brand.accent};\n  --brand-accent-ink: ${brand.accentInk};\n}\n`
  : ':root {\n  --brand-accent: #0b2e55;\n  --brand-accent-ink: #0b2e55;\n}\n';
fs.writeFileSync(path.join(process.cwd(), 'public', 'accent-tokens.css'), accentTokensCss);

// Mirrors lib/home-sales.ts's slugifyAddress() exactly -- deliberately
// duplicated rather than imported, since this file runs before Vite's
// module graph (and import.meta.env) exist, the same "duplicate across
// layers" tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR /
// normalize_venue() / QUORUM_NOTICE_RE.
function slugifyAddress(address) {
  return address
    .toLowerCase()
    .replace(/,.*$/, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirrors lib/home-sales.ts's extractZip() exactly -- same duplication
// tradeoff as slugifyAddress above.
function extractZip(address) {
  const match = address?.match(/\b(\d{5})\b\s*$/);
  return match ? match[1] : '';
}

// Mirrors lib/jobs.ts's slugifyCategory() exactly -- same duplication
// tradeoff as slugifyAddress above.
function slugifyCategory(category) {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirrors lib/content-slugs.ts's OLD_PREFIX_TO_PUBLIC/publicSlug() exactly --
// same duplication tradeoff as slugifyAddress above. Found missing here
// 2026-10-07 (AdSense remediation Phase 0, via a real
// verify_sitemap_noindex_disjoint.mjs run): every `/s/${s.slug}/` below used
// the raw DB slug (e.g. "vetenskap_kronika-2026-07-24"), but
// getStaticPaths() in s/[slug].astro actually builds the page at the PUBLIC
// slug (publicSlug(story.slug), e.g. "science-column-2026-07-24" -- see that
// file's own 2026-10-01 item 4 comment). The two paths never collided
// before because none of the four old-prefixed types were ever noindexed
// (only word-count-gated, and they're usually long enough not to trip it),
// so this mirror's wrong path simply never got checked against anything.
// Phase 0 made all six content-track types noindex unconditionally, which
// is what surfaced it: this mirror's noindexStoryUrls entry for e.g.
// "vetenskap_kronika-2026-07-24" could never match the real built page's
// pathname ("science-column-2026-07-24"), so the sitemap filter's
// `!noindexStoryUrls.has(pathname)` check always passed -- the real,
// noindexed page stayed listed in the sitemap anyway.
const OLD_PREFIX_TO_PUBLIC = {
  vardagsmiddag: 'recipe',
  vetenskap_kronika: 'science-column',
  kvick_essa: 'quick-essay',
  media_recension: 'review',
};
const OLD_PREFIX_RE_MIRROR = new RegExp(`^(${Object.keys(OLD_PREFIX_TO_PUBLIC).join('|')})-`);
function publicSlugMirror(dbSlug) {
  const match = dbSlug.match(OLD_PREFIX_RE_MIRROR);
  if (!match) return dbSlug;
  return OLD_PREFIX_TO_PUBLIC[match[1]] + dbSlug.slice(match[0].length - 1);
}

// AdSense "low value content" remediation, Phase A4: thin tag/category
// pages (fewer than 3 items) are noindexed in their own page frontmatter
// (jobs/category/[category].astro, home-sales/zip/[zip].astro) -- mirrored
// here so the sitemap agrees.
//
// events/[facet].astro UPDATE (2026-10-07, Broomfield sitemap fix): this was
// deliberately left unmirrored for exactly the reason above this edit --
// the real per-facet matching logic (lib/events.ts's isKidsEvent/
// isLibraryEvent/isToday/isThisWeekend, cross-source dedup in
// buildEventFeed) is genuinely non-trivial, and a wrong guess seemed worse
// than the known gap. Revisited because that "known gap" turned out to be
// a REAL, confirmed contradiction for Broomfield specifically (its events
// table has never had a working scraper -- see configs/broomfield_co.json
// -- so its 'today'/'this-weekend'/'kids'/'library' facets are
// permanently empty, permanently noindexed by the page, yet were still
// listed in its sitemap). The 'today'/'this-weekend'/'kids'/'library'
// facets are now mirrored below (search "events-facet mirror"); 'free'
// (unconditionally indexable) and 'campus' (SDSU-only, not part of this
// fix) are not. The mirror is deliberately simplified in ways that only
// ever OVERcount relative to the real page (see its own comment for which
// two) -- run scripts/verify_sitemap_noindex_disjoint.mjs against a real
// build of all three towns before trusting it, same as any other mirror
// in this file.
const MIN_TAG_PAGE_ITEMS = 3;

// Mirrors lib/noindex.ts's THIN_SCRAPED_SOURCE_TYPES / THIN_CONTENT_WORD_THRESHOLD
// / shouldNoindexStory() exactly -- same duplication tradeoff as
// slugifyAddress above. Keep both in sync: this decides which /s/<slug>/
// URLs are excluded from the sitemap, and it must agree with what the page
// itself puts in its own <meta name="robots"> (site/src/pages/s/[slug].astro),
// or a page could end up noindexed but still listed in the sitemap.
// Recipe SEO handoff: ingredients/instructions are folded into the word
// count the same way shouldNoindexStory() now does -- a vardagsmiddag row's
// real content lives in those structured fields, not just its short
// post-extraction intro `body` -- see that function's own comment for the
// live bug this fixes (every recipe permalink was silently noindexed).
// 2026-10-07, AdSense remediation Phase 0: the six generic AI content-track
// types joined this list on the lib/noindex.ts side -- see that file's own
// comment for why. Keep in sync by hand, same as every other mirror here.
const THIN_SCRAPED_SOURCE_TYPES = [
  'meeting', 'meeting_followup', 'event', 'alert',
  'culture_essay', 'editorial', 'vetenskap_kronika', 'kvick_essa', 'media_recension', 'vardagsmiddag',
];
const THIN_CONTENT_WORD_THRESHOLD = 250;
function isThinStory(sourceType, body, ingredients, instructions) {
  const isThinType = THIN_SCRAPED_SOURCE_TYPES.includes(sourceType);
  const structuredText = [...(ingredients ?? []), ...(instructions ?? [])].join(' ');
  const wordCount = `${body} ${structuredText}`.split(/\s+/).filter(Boolean).length;
  return isThinType || wordCount < THIN_CONTENT_WORD_THRESHOLD;
}

// Broomfield handoff (2026-09-30), Issue 3: /this-week/<slug>/ pages with
// fewer than MIN_TAG_PAGE_ITEMS real items are noindexed in the page itself
// (this-week/[week].astro, via lib/this-week.ts's shouldNoindexWeekPage())
// -- mirrored here so the sitemap agrees, same MIN_TAG_PAGE_ITEMS threshold
// already used for jobs/category and home-sales/zip above. Same
// duplication tradeoff as slugifyAddress/BRAND_TOKENS: site-config.ts's
// per-town timezone can't be imported here, and lib/this-week.ts's week-
// boundary math (mondayContaining/isoWeekInfo) is pure date logic with no
// DB/site-config dependency, so it's safe to copy verbatim rather than
// reimport.
//
// DELIBERATE SIMPLIFICATION, disclosed rather than silently attempted:
// this counts raw per-table rows and does NOT run them through
// buildEventFeed()'s cross-source dedup (an event double-listed by, say,
// both SDSU and the Chamber collapses to one item on the real page). That
// means this mirror's count is always >= the real page's count, so in the
// rare case a week sits exactly at the dedup boundary, this could list a
// genuinely-thin week as indexable when the page itself noindexes it --
// the one direction scripts/verify_sitemap_noindex_disjoint.mjs actually
// checks for. Verified against live 2026-09-30 data that no such
// disagreement currently exists; revisit if that script ever catches one.
const THIS_WEEK_TIMEZONES = {
  brookings_sd: 'America/Chicago',
  moreno_valley_ca: 'America/Los_Angeles',
  broomfield_co: 'America/Denver',
};

function localDatePartsMirror(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// UTC-read, no timezone conversion -- for bare-calendar-date fields
// (meeting_date-style), exactly like lib/this-week.ts's bareDateParts().
function utcDatePartsMirror(value) {
  const d = new Date(value);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// Mirrors lib/this-week.ts's utcMidnight() -- UTC midnight of the given
// calendar date, used (via localDatePartsMirror) as the events-facet
// mirror's own "today," exactly like lib/events.ts's todayUtcMidnight().
function utcMidnightMirror({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d));
}

function isoWeekSlugMirror({ y, m, d }) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0=Mon
  date.setUTCDate(date.getUTCDate() - dayNum); // back up to that week's Monday
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-w${String(isoWeek).padStart(2, '0')}`;
}

// Render-window handoff: mirrors site/src/lib/site-config.ts's
// CITIES.moreno_valley_ca.renderWindow.homeSales exactly -- same
// duplication tradeoff as slugifyAddress above (site-config.ts can't be
// imported here, same import.meta.env timing issue that file's own
// comment already documents). 24 months, signed off 2026-09-12 (12 was
// tried first the same day and reverted -- see site-config.ts's own
// comment on this value for why: Riverside County's data carries ~11-13
// months of built-in reporting lag, so a window measured from TODAY needs
// real headroom, not just the raw lag amount). Keep this in sync BY HAND
// with site-config.ts's own value, or this thin-page count silently
// drifts from what home-sales/zip/[zip].astro's own getStaticPaths
// actually builds.
const RENDER_WINDOW_HOME_SALES_MONTHS = 24;
function isWithinRenderWindowMirror(saleDate, months) {
  if (months === null || !saleDate) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return new Date(saleDate) >= cutoff;
}

// Mirrors lib/cross-site-canonical.ts's CROSS_SITE_CANONICAL_ORIGINS
// exactly -- same duplication tradeoff as slugifyAddress above. A
// non-origin town's page for one of these types carries a cross-domain
// <link rel="canonical"> (Phase C: cross-site duplication remediation),
// so it has no business also being advertised as this town's own
// indexable URL in ITS sitemap -- same "don't contradict the page's own
// signal" principle as noindexStoryUrls above, just via canonical instead
// of noindex (Google's own guidance: don't combine the two, one signal is
// enough).
const CROSS_SITE_CANONICAL_ORIGINS = {
  vardagsmiddag: 'brookings_sd',
  media_recension: 'moreno_valley_ca',
  vetenskap_kronika: 'broomfield_co',
};

// AdSense "low value content" remediation, Phase A4: every one of these
// top-level pages unconditionally or conditionally redirects via
// `Astro.redirect(...)` in its own frontmatter (grep `Astro\.redirect\(`
// under site/src/pages to re-verify this list is complete -- most redirect
// to `/` when a town/feature is inactive, but a couple redirect elsewhere:
// reviews.astro folds into /columns/ for Moreno Valley, this-week/index.astro
// always bounces to the current week's own page). Astro's static output
// still builds a real stub HTML file for every such redirect -- confirmed
// live TWICE: Brookings' own sitemap carried `/home-sales/` and
// `/home-sales/archive/` despite Brookings having zero property_sales data,
// and this exact list's first version still missed `/reviews/` and
// `/this-week/` because they redirect to a URL other than `/` -- caught by
// scripts/verify_sitemap_noindex_disjoint.mjs actually reading a real
// build's dist/ output, not by re-reading this list by eye. Mirrors each
// page's own gate condition and site-config.ts's CITIES table exactly
// (duplicated, not imported -- same tradeoff as slugifyAddress above).
// Keep both in sync: a page's gate condition changing without a matching
// update here silently lets a stub back into the sitemap. (The three
// dynamic-route redirects -- city-hall/projects/[slug].astro,
// facilities/[slug].astro, home-sales/[slug].astro's "0 sales" branch --
// are excluded from this list on purpose: getStaticPaths() only ever
// generates pages for rows that exist, so those branches are unreachable
// dead code in a static build and never produce a stub file.)
const TOWN_GATED_PAGES = [
  { path: '/burro-bonanza/', activeFor: ['moreno_valley_ca'] },
  { path: '/home-sales/', activeFor: ['moreno_valley_ca'] },
  { path: '/home-sales/archive/', activeFor: ['moreno_valley_ca'] },
  { path: '/sports/', activeFor: ['moreno_valley_ca'] },
  { path: '/farm-report/', activeFor: ['brookings_sd'] },
  { path: '/jackrabbits/', activeFor: ['brookings_sd'] },
  { path: '/play/', activeFor: ['brookings_sd'] },
  { path: '/university/', activeFor: ['brookings_sd'] },
  { path: '/vail-resorts/', activeFor: ['broomfield_co'] },
  // 301s to /columns/ for Moreno Valley only (media_recension folded in
  // there -- see reviews.astro's own comment); real content for the other
  // two towns.
  { path: '/reviews/', activeFor: ['brookings_sd', 'broomfield_co'] },
  // Always redirects to the current ISO week's own page
  // (/this-week/<slug>/, already indexed separately) -- not town-gated at
  // all, a rolling pointer for every town (see this-week/index.astro).
  { path: '/this-week/', activeFor: [] },
  // Feature-flag-gated (not town-gated) -- mirrors CITIES' hasClosureWatch/
  // hasWorkplaceWatch/hasNewInTown booleans in site-config.ts exactly.
  { path: '/closures/', activeFor: ['brookings_sd', 'moreno_valley_ca'] },
  { path: '/workplace-watch/', activeFor: ['moreno_valley_ca', 'broomfield_co'] },
  // hasNewInTown is false for all three towns today (the Brave-search
  // pipeline behind it isn't built yet -- see configs/*.json's new_in_town
  // "_notes") -- a pure stub everywhere until that ships.
  { path: '/new-in-town/', activeFor: [] },
  // What's On: hasWhatsOn is true for all three towns as of the Phase 7
  // venue-curation follow-up (Moreno Valley/Broomfield needed their own
  // venue curation before enabling -- see site-config.ts's own ticketmaster
  // comments for each). Only the LISTING page (a single static path) needs
  // an entry here -- /whats-on/[slug]/ detail pages are excluded from this
  // list on purpose, same reasoning as city-hall/projects/[slug].astro
  // etc.'s own dynamic-route exclusion above: that page's own
  // getStaticPaths() returns [] when the flag is off, so no detail-page
  // stub file is ever produced to need excluding.
  { path: '/whats-on/', activeFor: ['brookings_sd', 'moreno_valley_ca', 'broomfield_co'] },
];

/**
 * Real per-page lastmod dates for the sitemap (SEO Fas 1.1). A bare
 * sitemap() with no serialize() either omits lastmod or -- worse --
 * @astrojs/sitemap can stamp every URL with the CURRENT BUILD time, which
 * actively lies to Google: a project page untouched for two months looks
 * freshly edited on every hourly rebuild. Queried directly here rather
 * than via lib/db.ts (which assumes import.meta.env, not available in this
 * plain-Node config context) -- one broad query per table, same
 * "fetch once, look up per URL" shape as the rest of this codebase's
 * "fetch broad once" pattern (see lib/events.ts).
 */
async function buildLastmodMap(townId, databaseUrl) {
  const map = new Map();
  // Individual home-sale parcel pages are always excluded from the
  // sitemap (AdSense "low value content" remediation, Phase A2 -- thin,
  // derivative content against Riverside County's own public assessor
  // report, noindexed unconditionally in home-sales/[slug].astro
  // regardless of sale recency) -- built alongside lastmod since it
  // reuses the exact same parcels query below. The aggregate /home-sales
  // table, its ZIP facets, and the monthly digest are untouched -- only
  // per-parcel URLs ever land here.
  const noindexHomeSaleUrls = new Set();
  // Thin tag/category pages (jobs/category/*, home-sales/zip/*) -- see
  // MIN_TAG_PAGE_ITEMS' own comment above.
  //
  // AdSense "low value content" remediation, Phase 0 (2026-10-07): the four
  // content-track archive index pages carry an unconditional `noindex` prop
  // now (see reviews.astro/recipes.astro/editorials.astro/columns.astro) --
  // a path-shape check, not a DB query, same reasoning as the
  // isWhatsOnDetailPage check in the sitemap filter below: these are
  // top-level static pages with no per-row data to query, always noindexed,
  // never conditionally. /reviews/ redirects away for Moreno Valley (see
  // TOWN_GATED_PAGES/excludedGatedPages above) -- adding it here too is
  // harmless for that town (the Set just never matches a pathname that was
  // never built).
  const noindexThinPageUrls = new Set(['/reviews/', '/recipes/', '/editorials/', '/columns/']);
  // Town/feature-gated stub pages excluded for THIS build's town -- see
  // TOWN_GATED_PAGES' own comment above.
  const excludedGatedPages = new Set(
    TOWN_GATED_PAGES.filter((p) => !p.activeFor.includes(townId)).map((p) => p.path),
  );
  // e.g. `astro check`'s CI job deliberately runs with no DATABASE_URL
  // (see tests.yml) -- an empty map just means no lastmod hints, never a
  // build failure.
  if (!databaseUrl) {
    return {
      map, noindexHomeSaleUrls, excludedGatedPages, noindexStoryUrls: new Set(),
      noindexThinPageUrls, crossCanonicalStoryUrls: new Set(),
    };
  }
  const sql = neon(databaseUrl);

  const noindexStoryUrls = new Set();
  const crossCanonicalStoryUrls = new Set();
  const stories = await sql`
    SELECT slug, published_at, source_type, body, generated_by, ingredients, instructions, occurs_at, title, venue_raw FROM stories WHERE town_id = ${townId}
  `;
  for (const s of stories) {
    const storyPathname = `/s/${publicSlugMirror(s.slug)}/`;
    map.set(storyPathname, s.published_at);
    // generated_by === 'data_pending': mirrors s/[slug].astro's own
    // pre-existing noindex rule for "not yet released" placeholders (see
    // that page's own comment) -- folded in here alongside the new
    // thin-content rule so both reasons a story can be noindexed are
    // reflected in the sitemap, not just the new one.
    //
    // s.published_at === null: mirrors lib/noindex.ts's shouldNoindexStory()
    // published_at check exactly -- an "unpublished" row (see
    // NEEDS-HUMAN-REVIEW.md's quarantine rows) must not be advertised in the
    // sitemap as indexable just because it isn't thin. Confirmed live
    // 2026-09-03 this mirror had drifted from the page's own noindex logic
    // the same way the module comment above already warns about.
    if (s.generated_by === 'data_pending' || s.published_at === null || isThinStory(s.source_type, s.body, s.ingredients, s.instructions)) {
      noindexStoryUrls.add(storyPathname);
    }
    const canonicalOrigin = CROSS_SITE_CANONICAL_ORIGINS[s.source_type];
    if (canonicalOrigin && canonicalOrigin !== townId) {
      crossCanonicalStoryUrls.add(storyPathname);
    }
  }

  const projects = await sql`SELECT slug, updated_at FROM projects WHERE town_id = ${townId}`;
  for (const p of projects) map.set(`/city-hall/projects/${p.slug}/`, p.updated_at);

  const facilities = await sql`
    SELECT slug, verified_date FROM places
     WHERE town_id = ${townId} AND verified_date IS NOT NULL
  `;
  for (const f of facilities) map.set(`/facilities/${f.slug}/`, f.verified_date);

  // property_sales only exists for Moreno Valley (Riverside County's
  // assessor report doesn't cover South Dakota) -- same naturally-empty-
  // elsewhere pattern as getPropertySaleParcels() in lib/db.ts.
  if (townId === 'moreno_valley_ca') {
    const parcels = await sql`
      SELECT DISTINCT ON (pin) pin, address, sale_date
        FROM property_sales
       WHERE town_id = ${townId} AND pin IS NOT NULL
       ORDER BY pin, sale_date DESC
    `;
    for (const p of parcels) {
      if (!p.address) continue;
      const pathname = `/home-sales/${slugifyAddress(p.address)}/`;
      if (p.sale_date) map.set(pathname, p.sale_date);
      noindexHomeSaleUrls.add(pathname);
    }
  }

  // jobs isn't town-restricted (see jobs.astro's own "no town redirect"
  // reasoning) -- built for all three towns. Mirrors getRecentJobs()'s
  // default call shape exactly (limit=100, JOBS_MAX_AGE_DAYS=45).
  const jobs = await sql`
    SELECT category FROM jobs
     WHERE town_id = ${townId}
       AND (posted_at IS NULL OR posted_at >= now() - interval '45 days')
     ORDER BY posted_at DESC NULLS LAST
     LIMIT 100
  `;
  const jobCategoryCounts = new Map();
  for (const j of jobs) {
    if (!j.category) continue;
    jobCategoryCounts.set(j.category, (jobCategoryCounts.get(j.category) ?? 0) + 1);
  }
  for (const [category, count] of jobCategoryCounts) {
    if (count < MIN_TAG_PAGE_ITEMS) noindexThinPageUrls.add(`/jobs/category/${slugifyCategory(category)}/`);
  }

  // property_sales only exists for Moreno Valley -- home-sales/zip/[zip].astro
  // is naturally never built elsewhere (getStaticPaths returns [] there).
  // Mirrors getRecentPropertySales(5000)'s call shape from that page exactly.
  if (townId === 'moreno_valley_ca') {
    const zipSales = await sql`
      SELECT address, sale_date FROM property_sales
       WHERE town_id = ${townId}
       ORDER BY sale_date DESC
       LIMIT 5000
    `;
    const zipCounts = new Map();
    for (const s of zipSales) {
      if (!isWithinRenderWindowMirror(s.sale_date, RENDER_WINDOW_HOME_SALES_MONTHS)) continue;
      const zip = extractZip(s.address);
      if (!zip) continue;
      zipCounts.set(zip, (zipCounts.get(zip) ?? 0) + 1);
    }
    for (const [zip, count] of zipCounts) {
      if (count < MIN_TAG_PAGE_ITEMS) noindexThinPageUrls.add(`/home-sales/zip/${zip}/`);
    }
  }

  // /this-week/<slug>/ thin-week mirror -- see THIS_WEEK_TIMEZONES' own
  // comment above for the counting caveat. A week only gets a page (per
  // [week].astro's own getStaticPaths) if a real 'weekly' story exists for
  // it, or it's the current week -- so those are the only slugs checked.
  const thisWeekTz = THIS_WEEK_TIMEZONES[townId] ?? THIS_WEEK_TIMEZONES.brookings_sd;
  const weekItemCounts = new Map();
  const bumpWeek = (slug) => weekItemCounts.set(slug, (weekItemCounts.get(slug) ?? 0) + 1);

  const pageWeekSlugs = new Set([isoWeekSlugMirror(localDatePartsMirror(new Date(), thisWeekTz))]);
  for (const s of stories) {
    if (!s.occurs_at) continue;
    if (s.source_type === 'weekly') {
      pageWeekSlugs.add(isoWeekSlugMirror(localDatePartsMirror(new Date(s.occurs_at), thisWeekTz)));
    } else if (s.source_type === 'event') {
      bumpWeek(isoWeekSlugMirror(localDatePartsMirror(new Date(s.occurs_at), thisWeekTz)));
    } else if (s.source_type === 'meeting' || s.source_type === 'meeting_followup') {
      bumpWeek(isoWeekSlugMirror(utcDatePartsMirror(s.occurs_at)));
    }
  }

  const projectUpdates = await sql`
    SELECT u.meeting_date FROM project_updates u JOIN projects p ON p.id = u.project_id
     WHERE p.town_id = ${townId} AND u.meeting_date IS NOT NULL
  `;
  for (const u of projectUpdates) bumpWeek(isoWeekSlugMirror(utcDatePartsMirror(u.meeting_date)));

  if (townId === 'brookings_sd') {
    const games = await sql`SELECT starts_at FROM sports_games WHERE town_id = ${townId} AND starts_at IS NOT NULL`;
    for (const g of games) bumpWeek(isoWeekSlugMirror(localDatePartsMirror(new Date(g.starts_at), thisWeekTz)));
  } else {
    const regionalGames = await sql`SELECT game_date FROM regional_sports_games WHERE town_id = ${townId} AND game_date IS NOT NULL`;
    for (const g of regionalGames) bumpWeek(isoWeekSlugMirror(utcDatePartsMirror(g.game_date)));
  }

  for (const slug of pageWeekSlugs) {
    if ((weekItemCounts.get(slug) ?? 0) < MIN_TAG_PAGE_ITEMS) noindexThinPageUrls.add(`/this-week/${slug}/`);
  }

  // /events/<facet>/ thin-facet mirror (2026-10-07, Broomfield sitemap fix):
  // mirrors pages/events/[facet].astro's own `isNoindex = facet.slug ===
  // 'free' ? false : items.length < 3` for the 'today'/'this-weekend'/
  // 'kids'/'library' facets only ('free' is explicitly exempt on that page
  // and 'campus' isn't part of this fix). Deliberately simplified relative
  // to the real page in two ways, both erring the SAME safe direction
  // THIS_WEEK_TIMEZONES' own comment above documents (this mirror's count
  // >= the real page's): (1) no cross-source dedup against SDSU arts
  // events (lib/events.ts's buildEventFeed) -- dedup only ever REDUCES a
  // count, so skipping it can only overcount; (2) arts events themselves
  // aren't counted at all here, acceptable because the one town with a real
  // arts feed (brookings_sd) already has hundreds of plain 'event' stories
  // a week, nowhere near the MIN_TAG_PAGE_ITEMS=3 boundary this exists to
  // protect. Verify with scripts/verify_sitemap_noindex_disjoint.mjs
  // against a real build before trusting this for a town/facet combination
  // that's actually close to the line.
  const eventFacetCounts = { today: 0, 'this-weekend': 0, kids: 0, library: 0 };
  const KIDS_RE_MIRROR = /\b(kids?|children|childrens?|toddler|preschool|storytime|story time|famil(?:y|ies)|youth|teens?|tween)\b/i;
  const facilityVenues = await sql`
    SELECT name, aliases, category FROM places WHERE town_id = ${townId} AND category = 'library'
  `;
  const normalizeVenueMirror = (raw) => {
    if (!raw || !raw.trim()) return null;
    const namePart = raw.split(',')[0].replace(/^[A-Z0-9 .'-]+:\s*/, '');
    const normalized = namePart.replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized || null;
  };
  const libraryVenueNames = new Set();
  for (const f of facilityVenues) {
    for (const candidate of [f.name, ...(f.aliases ?? [])]) {
      const norm = normalizeVenueMirror(candidate);
      if (norm) libraryVenueNames.add(norm);
    }
  }
  const eventsToday = utcMidnightMirror(localDatePartsMirror(new Date(), thisWeekTz));
  const weekdayOfTodayMirror = eventsToday.getUTCDay();
  const daysToFridayMirror = (5 - weekdayOfTodayMirror + 7) % 7;
  for (const s of stories) {
    if (s.source_type !== 'event' || !s.occurs_at) continue;
    if (new Date(s.occurs_at) < new Date(Date.now() - 12 * 60 * 60 * 1000)) continue;
    const eventDay = utcMidnightMirror(localDatePartsMirror(new Date(s.occurs_at), thisWeekTz));
    const offset = Math.round((eventDay.getTime() - eventsToday.getTime()) / 86_400_000);
    if (offset <= 0) eventFacetCounts.today++;
    if (offset >= daysToFridayMirror && offset <= daysToFridayMirror + 2) eventFacetCounts['this-weekend']++;
    const haystack = `${s.title ?? ''} ${(s.body ?? '').slice(0, 200)}`;
    if (KIDS_RE_MIRROR.test(haystack)) eventFacetCounts.kids++;
    const venueNorm = normalizeVenueMirror(s.venue_raw);
    if (venueNorm && libraryVenueNames.has(venueNorm)) eventFacetCounts.library++;
  }
  for (const [facetSlug, count] of Object.entries(eventFacetCounts)) {
    if (count < MIN_TAG_PAGE_ITEMS) noindexThinPageUrls.add(`/events/${facetSlug}/`);
  }

  return {
    map, noindexHomeSaleUrls, excludedGatedPages, noindexStoryUrls, noindexThinPageUrls,
    crossCanonicalStoryUrls,
  };
}

const {
  map: lastmodMap, noindexHomeSaleUrls, excludedGatedPages, noindexStoryUrls, noindexThinPageUrls,
  crossCanonicalStoryUrls,
} = await buildLastmodMap(activeCity, env.DATABASE_URL);

export default defineConfig({
  site: SITE_URLS[activeCity] ?? SITE_URLS.brookings_sd,
  output: 'static',
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        // Pre-existing bug, unrelated to the recipe/front-page work this
        // build was actually verifying -- found by scripts/verify_sitemap_
        // noindex_disjoint.mjs against a real build with live Ticketmaster
        // data: every /whats-on/<slug>/ DETAIL page carries noindex
        // unconditionally, by design (see that page's own doc comment --
        // only the /whats-on/ LISTING page is meant to be indexable), but
        // nothing in this filter ever excluded them, since they're built
        // from live Ticketmaster data, not a `stories` row, so none of the
        // existing noindex*Urls sets above ever see them. Path-shape check,
        // not a DB query, since noindex here doesn't depend on any per-item
        // data -- EVERY detail page is noindexed, always.
        const isWhatsOnDetailPage = pathname.startsWith('/whats-on/') && pathname !== '/whats-on/';
        return !noindexHomeSaleUrls.has(pathname)
          && !excludedGatedPages.has(pathname)
          && !noindexStoryUrls.has(pathname)
          && !noindexThinPageUrls.has(pathname)
          && !crossCanonicalStoryUrls.has(pathname)
          && !isWhatsOnDetailPage;
      },
      serialize(item) {
        const lastmod = lastmodMap.get(new URL(item.url).pathname);
        return lastmod ? { ...item, lastmod: new Date(lastmod).toISOString() } : item;
      },
    }),
  ],
});
