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
