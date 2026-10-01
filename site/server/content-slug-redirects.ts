/**
 * 2026-10-01 cleanup round, item 4 -- 301s an old Swedish-prefixed `/s/`
 * slug (vardagsmiddag-, vetenskap_kronika-, kvick_essa-, media_recension-)
 * to its new English-prefixed public path (recipe-, science-column-,
 * quick-essay-, review-). See site/src/lib/content-slugs.ts's own module
 * docstring for the full "why" -- this file is that module's hand-
 * duplicated TS twin, not an import of it, because server/*.ts bundles
 * separately from site/src/* (wrangler's own esbuild vs. Astro/Vite -- see
 * server/worker.ts's own top-of-file comment on why this file exists at
 * all, and confirmed live: nothing under server/ imports from site/src/
 * anywhere in this codebase today). OLD_PREFIX_TO_PUBLIC below MUST stay in
 * sync, by hand, with content-slugs.ts's own copy and
 * ai_pipeline/daily_content.py's SLUG_PREFIX_OVERRIDES -- three copies of
 * the same four-entry map, the same cross-layer duplication tradeoff this
 * codebase already accepts elsewhere (e.g. site-config.ts's BRAND_TOKENS
 * mirrored in astro.config.mjs).
 *
 * Deliberately a pure prefix-swap function, not a static JSON table of all
 * 67 affected rows (unlike legacy-meeting-redirects.json, which exists
 * because THAT migration wasn't a pure function -- a dedup decision had to
 * be made per row). A function can't drift from the data and needs no
 * regeneration step as rows are added.
 */
const OLD_PREFIX_TO_PUBLIC: Record<string, string> = {
  vardagsmiddag: 'recipe',
  vetenskap_kronika: 'science-column',
  kvick_essa: 'quick-essay',
  media_recension: 'review',
};

const OLD_PREFIX_RE = new RegExp(`^(${Object.keys(OLD_PREFIX_TO_PUBLIC).join('|')})-`);

/** Given a request pathname, returns the new `/s/<public-slug>/` path to
 *  301 to, or null if this isn't an old-prefixed content slug (every other
 *  path -- meetings, events, alerts, already-English new rows -- is a
 *  no-op here, same as content-slugs.ts's own publicSlug()). Pulled out as
 *  a pure function so it's directly testable without a real Request
 *  (see content-slug-redirects.test.ts), same convention as
 *  resolveLegacyMeetingRedirect() in _shared.ts. */
export function resolveContentSlugRedirect(pathname: string): string | null {
  const slug = pathname.replace(/^\/s\/|\/$/g, '');
  const match = slug.match(OLD_PREFIX_RE);
  if (!match) return null;
  const publicSlug = OLD_PREFIX_TO_PUBLIC[match[1]] + slug.slice(match[0].length - 1);
  return `/s/${publicSlug}/`;
}
