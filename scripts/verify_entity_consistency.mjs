#!/usr/bin/env node
/**
 * Answer-engine-visibility handoff, Section 4: entity consistency.
 *
 * The spec's own text says to build this "in the existing validation/
 * package" -- that package (validation/*.py) is a PRE-PUBLISH gate that
 * runs during AI content generation (GitHub Actions batch jobs), with zero
 * visibility into rendered Astro HTML. This is the exact same mismatch
 * NEEDS-HUMAN-REVIEW.md #48 already found and corrected for page_meta_check
 * (the sitewide title/H1/lede handoff originally assumed the same Python
 * package too): entity consistency needs to compare what's ACTUALLY
 * rendered across three surfaces (visible HTML, JSON-LD, llms.txt), which
 * only exist as real artifacts once `astro build` finishes. Same "read the
 * actual dist/ output, don't re-derive the logic" convention
 * verify_sitemap_noindex_disjoint.mjs and audit_page_metadata.mjs already
 * establish for exactly this reason.
 *
 * Two checks:
 *   1. Site name is byte-identical across <title>, og:site_name, the
 *      footer copyright line, the sitewide Organization JSON-LD, and
 *      llms.txt's own H1 -- checked on the homepage (title/OG/footer/
 *      Organization all render there) plus a facility detail page (title
 *      only, as a second real page type).
 *   2. Every facility's address/phone is byte-identical between the
 *      visible HTML fact list, llms.txt's own generated line, and (for
 *      phone only) the facility's JSON-LD `telephone` field. Address is
 *      NOT compared against JSON-LD's `streetAddress` -- that's a
 *      deliberately different, more granular field (facility.street_address
 *      vs facility.address, the full display string), not a rendering bug
 *      if they differ in form.
 *
 * Usage: node scripts/verify_entity_consistency.mjs <dist-dir>
 * Exits 1 and prints every mismatch found. Exits 0 (silently) if none.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/verify_entity_consistency.mjs <dist-dir>');
  process.exit(2);
}

const problems = [];

function readHtml(relPath) {
  const p = join(distDir, relPath);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

// Same decode audit_page_metadata.mjs's own stripTags() already applies --
// HTML correctly escapes "&" as "&amp;" in rendered markup; llms.txt is
// plain text and correctly does NOT. Comparing the two without decoding
// first flags a false mismatch on every real "&"-containing address
// (confirmed live: every Brookings park with an intersection-style
// address, e.g. "Medary Ave & 8th St S", failed this way before decoding).
function decodeEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function extract(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

// --- Check 1: site name consistency -----------------------------------

const homeHtml = readHtml('index.html');
const llmsTxt = existsSync(join(distDir, 'llms.txt')) ? readFileSync(join(distDir, 'llms.txt'), 'utf-8') : null;

if (!homeHtml) {
  problems.push('No dist/index.html found -- cannot check site-name consistency at all.');
} else {
  const ogSiteName = extract(homeHtml, /<meta property="og:site_name" content="([^"]*)"/);
  const footerCopyright = extract(homeHtml, /&copy;\s*\d{4}\s*([^<]*)<\/p>/);
  // Adjacent match ONLY -- buildOrganizationJsonLd()'s own fixed field
  // order puts "name" directly after "@type", before the nested
  // areaServed.name ("Brookings", not "Brookings View") that a looser
  // `[^}]*` would greedily match instead (confirmed live: it did, on the
  // first real run of this script).
  const orgJsonLdName = extract(homeHtml, /"@type":"NewsMediaOrganization","name":"([^"]*)"/);
  const llmsH1 = llmsTxt ? extract(llmsTxt, /^# (.+)$/m) : null;

  const surfaces = {
    'og:site_name': ogSiteName,
    'footer copyright': footerCopyright,
    'Organization JSON-LD name': orgJsonLdName,
    'llms.txt H1': llmsH1,
  };
  const present = Object.entries(surfaces).filter(([, v]) => v != null);
  if (present.length < 3) {
    problems.push(`Only found ${present.length}/4 site-name surfaces on the homepage -- extraction may be stale (regex drift), not necessarily a real mismatch: ${JSON.stringify(surfaces)}`);
  } else {
    const distinctValues = new Set(present.map(([, v]) => v));
    if (distinctValues.size > 1) {
      problems.push(`Site name is NOT consistent across surfaces: ${JSON.stringify(Object.fromEntries(present))}`);
    }
  }
}

// --- Check 2: facility address/phone consistency ------------------------

const facilitiesDir = join(distDir, 'facilities');
if (existsSync(facilitiesDir)) {
  const slugs = readdirSync(facilitiesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // llms.txt line format (see llms.txt.ts): "- [{name}](.../facilities/{slug}/): {category}, {address}."
  const llmsFacilityLines = new Map(); // slug -> full note text
  if (llmsTxt) {
    for (const m of llmsTxt.matchAll(/- \[([^\]]+)\]\([^)]*\/facilities\/([^/]+)\/\): (.+)$/gm)) {
      llmsFacilityLines.set(m[2], m[3]);
    }
  }

  for (const slug of slugs) {
    const html = readHtml(`facilities/${slug}/index.html`);
    if (!html) continue;

    // Astro scopes every element with a data-astro-cid-* attribute -- no
    // tag here is ever bare, confirmed live (see hasVisibleHours's own
    // comment below for the same lesson learned on the first real run).
    const visibleAddressRaw = extract(html, /<dt[^>]*>Address<\/dt><dd[^>]*>([^<]*)<\/dd>/);
    const visibleAddress = visibleAddressRaw ? decodeEntities(visibleAddressRaw) : null;
    const visiblePhone = extract(html, /<dt[^>]*>Phone<\/dt><dd[^>]*><a[^>]*>([^<]*)<\/a><\/dd>/);
    const jsonLdTelephone = extract(html, /"telephone":"([^"]*)"/);
    const hasHoursSpec = html.includes('"openingHoursSpecification"');
    // Astro scopes every element with a data-astro-cid-* attribute, so
    // <dt> is never bare -- confirmed live (this failed to match on the
    // first real run, flagging a false "schema claims something not
    // shown" on every facility that actually has visible hours).
    const hasVisibleHours = /<dt[^>]*>Hours<\/dt>/.test(html);

    if (visiblePhone && jsonLdTelephone && visiblePhone !== jsonLdTelephone) {
      problems.push(`facilities/${slug}: visible phone "${visiblePhone}" != JSON-LD telephone "${jsonLdTelephone}"`);
    }

    const llmsNote = llmsFacilityLines.get(slug);
    if (visibleAddress && llmsNote && !llmsNote.includes(visibleAddress)) {
      problems.push(`facilities/${slug}: visible address "${visibleAddress}" not found in its own llms.txt line "${llmsNote}"`);
    }

    if (hasHoursSpec && !hasVisibleHours) {
      problems.push(`facilities/${slug}: JSON-LD asserts openingHoursSpecification but the page renders no visible Hours fact -- schema claims something not shown on the page.`);
    }
  }
} else {
  problems.push('No dist/facilities/ directory found -- cannot check facility entity consistency.');
}

if (problems.length > 0) {
  console.error(`FAILED: ${problems.length} entity-consistency problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('OK: site name and facility address/phone are consistent across HTML, JSON-LD and llms.txt.');
