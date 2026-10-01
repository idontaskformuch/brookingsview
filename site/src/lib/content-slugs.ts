/**
 * 2026-10-01 cleanup round, item 4: four content tracks have always used a
 * Swedish word as the literal `/s/<slug>/` URL prefix (source_type's own
 * internal name, reused verbatim as the slug prefix at publish time) --
 * vardagsmiddag, vetenskap_kronika, kvick_essa, media_recension. New rows
 * now get an English prefix instead (see ai_pipeline/daily_content.py's own
 * SLUG_PREFIX_OVERRIDES, the Python-side twin of OLD_SWEDISH_PREFIX_TO_PUBLIC
 * below -- keep both in sync by hand, same cross-layer duplication this
 * codebase already accepts elsewhere, e.g. site-config.ts's BRAND_TOKENS
 * mirrored in astro.config.mjs).
 *
 * Per explicit instruction, existing DB rows' `slug` COLUMN is never
 * rewritten -- every function here is a pure, one-way PRESENTATION-layer
 * transform (DB slug -> public URL slug), applied at the point a URL is
 * actually built, never stored back. Anything that uses story.slug as a
 * DATABASE KEY (WorkerPulseComments' pageSlug, review_quality_flags'
 * story_slug, getStaticPaths()'s own lookup) must keep using the REAL,
 * untransformed story.slug -- only an actual rendered href/canonical/
 * sitemap/RSS URL should ever pass through publicSlug()/storyHref().
 *
 * Deliberately a prefix swap (regex-anchored at the start of the slug),
 * not a lookup table of all 67 affected rows -- a pure function can't drift
 * from the data (a row published today with the OLD prefix, if that ever
 * happened by mistake, would still resolve correctly) and needs no
 * maintenance as rows are added. The vardagsmiddag->recipe swap already
 * shipped once before (2026-08-23, see daily_content.py's own comment) for
 * NEW rows only, with no redirect for old ones -- this extends that same
 * mapping to the other three types AND adds the redirect/canonical-rewrite
 * layer that first pass deliberately skipped.
 */

// Keyed by the OLD (Swedish) prefix exactly as it appears at the start of a
// `stories.slug` value -- the DB `source_type` column for these rows is
// identical to the key, but this map is keyed on the literal slug text, not
// source_type, so it transforms correctly regardless of how a given row's
// prefix came to be set.
const OLD_PREFIX_TO_PUBLIC: Record<string, string> = {
  vardagsmiddag: 'recipe',
  vetenskap_kronika: 'science-column',
  kvick_essa: 'quick-essay',
  media_recension: 'review',
};

// Matches "<prefix>-" at the very start of a slug, prefix being one of the
// old map's keys -- e.g. "media_recension-2026-07-22" or
// "vardagsmiddag-2026-05-01" (anything after the prefix, usually a date, is
// preserved verbatim). Built from the map's own keys so adding a new
// mapping above can never silently fail to match here.
const OLD_PREFIX_RE = new RegExp(`^(${Object.keys(OLD_PREFIX_TO_PUBLIC).join('|')})-`);

/** DB slug -> public URL slug. A no-op (returns the input unchanged) for
 *  every slug that doesn't start with one of the four old prefixes --
 *  already-English new rows (e.g. "recipe-2026-10-02") and every other
 *  content type (meetings, events, alerts, ...) pass straight through. */
export function publicSlug(dbSlug: string): string {
  const match = dbSlug.match(OLD_PREFIX_RE);
  if (!match) return dbSlug;
  return OLD_PREFIX_TO_PUBLIC[match[1]] + dbSlug.slice(match[0].length - 1);
}

/** The full `/s/<public-slug>/` path for a story, given its real DB slug.
 *  Use this (not a hand-built `/s/${slug}/` template) everywhere a story
 *  link, canonical URL, sitemap loc, or RSS link is constructed. */
export function storyHref(dbSlug: string): string {
  return `/s/${publicSlug(dbSlug)}/`;
}

/** True when a slug carries one of the old Swedish prefixes -- i.e. when
 *  publicSlug() would actually change it. Used by the redirect layer
 *  (server/content-slug-redirects.ts, a hand-duplicated TS twin of this
 *  module -- see that file's own comment for why it can't just import this
 *  one) to decide whether an incoming request needs a 301 at all. Exported
 *  mainly so tests can assert the two implementations agree. */
export function hasOldPrefix(dbSlug: string): boolean {
  return OLD_PREFIX_RE.test(dbSlug);
}
