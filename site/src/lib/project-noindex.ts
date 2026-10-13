/** Whether a /city-hall/projects/[slug]/ page should carry noindex --
 *  Phase 6 (.claude/spec-phases-3-9.md): "Indexable only with >=2 updates
 *  or a substantive source document; otherwise noindex." A substantive
 *  source document means a REAL confirmed outcome (an Action Summary /
 *  Legistar matter-history result), not just an agenda listing -- every
 *  meeting-sourced update already carries SOME source_url (the bare
 *  agenda, when nothing else exists yet -- see ai_pipeline/
 *  project_updates.py's upsert_project_update()), so "has a source_url"
 *  alone would never actually gate anything. A confirmed, non-'pending'
 *  outcome is the real substantive-document signal.
 *
 *  Mirrored (not imported) into astro.config.mjs's sitemap filter, same
 *  reason as that file's own isThinStory()/BRAND_TOKENS duplication
 *  comments: astro.config.mjs evaluates before Vite's env pipeline and
 *  deliberately imports no site/src/lib module, to keep that one
 *  constraint simple and visible in a single place rather than risking a
 *  module that quietly assumes import.meta.env. Keep both copies of this
 *  rule in sync by hand -- scripts/verify_sitemap_noindex_disjoint.mjs
 *  catches drift between the page's own noindex and the sitemap. */
export const MIN_INDEXABLE_PROJECT_UPDATES = 2;

export function shouldNoindexProject(updates: { outcome: string }[]): boolean {
  if (updates.length >= MIN_INDEXABLE_PROJECT_UPDATES) return false;
  return !updates.some((u) => u.outcome !== 'pending');
}
