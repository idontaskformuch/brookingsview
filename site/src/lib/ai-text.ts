import { storyHref } from './content-slugs';

/** AI-written story text is never printed (owner 2026-11-05/06, "AI-text bort överallt"). `stories.generated_by` is
 *  "ai:<model>" (e.g. "ai:claude-...") for model-written rows; "template_fallback", "human", "data_pending" and
 *  "zero_sales" are not model text. Every layout that prints a story's text goes through publicBody(), so nothing
 *  reaches a reader from a model; titles, dates and the structured meta fields are unaffected. The stored text stays
 *  in the database untouched (no regeneration, no writes). Enforced by ai-text.test.ts. */
export function isAiText(story: { generated_by?: string | null }): boolean {
  return /^ai:/.test(story.generated_by ?? '');
}

/** The story text a layout may print: '' for model-written rows, the stored text otherwise. */
export function publicBody(story: { body: string; generated_by?: string | null }): string {
  return isAiText(story) ? '' : story.body;
}

/** The story's own /s/ page, or null when its text is withheld: that page is an empty shell (noindex), so nothing may link to it. */
export function ownPageHref(story: { slug: string; generated_by?: string | null }): string | null {
  return isAiText(story) ? null : storyHref(story.slug);
}

/** Where a list row sends the reader: the story's own page when it has text, otherwise the original source (events,
 *  meetings), otherwise null -- render the title as plain text. */
export function linkTarget(story: { slug: string; generated_by?: string | null; source_url?: string | null }): string | null {
  return ownPageHref(story) ?? (story.source_url && /^https?:\/\//.test(story.source_url) ? story.source_url : null);
}
