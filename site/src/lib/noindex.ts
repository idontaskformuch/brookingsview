/** Which /s/[slug]/ stories should carry noindex,follow -- AdSense "low
 *  value content" remediation, Phase A2/A3. Two independent reasons:
 *
 *   1. The story's source_type is inherently thin/derivative scraped-feed
 *      content -- an individually-formatted civic meeting, event, or
 *      weather alert is redundant against its original source no matter
 *      how well it reads. These stay fully visible and linked from their
 *      list views (/events, /this-week, /city-hall, the homepage) -- only
 *      the standalone permalink is de-indexed.
 *   2. A word-count safety net: ANY story under the threshold gets
 *      noindexed regardless of type, so an unusually thin editorial,
 *      essay, or digest doesn't slip through unnoticed.
 *
 *  Deliberately does NOT cover job listings, traffic incidents, or school
 *  closure notices -- confirmed live (2026-08-29) that none of those exist
 *  as individual permalinks in this codebase (jobs.astro/[category].astro
 *  are tables with no per-job route; traffic.astro and closures.astro are
 *  single live-status pages, not per-incident/per-notice routes) -- there
 *  is nothing to noindex there today. */
import type { SourceType, Story } from './db';

export const THIN_SCRAPED_SOURCE_TYPES: SourceType[] = ['meeting', 'meeting_followup', 'event', 'alert'];
export const THIN_CONTENT_WORD_THRESHOLD = 250;

export function countWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

let wordCountNoindexTally = 0;
let exitHandlerRegistered = false;

/** Node fires 'exit' once the whole `astro build` process is about to end
 *  -- the only reliable "build finished" hook reachable from here, since a
 *  page component is invoked once per story with no visibility into how
 *  many other stories exist or when the last one renders. Registered at
 *  most once, regardless of how many stories trip the word-count rule. */
function scheduleWordCountSummaryLog(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.on('exit', () => {
    console.log(`[build] ${wordCountNoindexTally} page(s) noindexed by word-count rule (<${THIN_CONTENT_WORD_THRESHOLD} words)`);
  });
}

/** Test-only escape hatch -- vitest runs many independent test files that
 *  would otherwise share this module's counter state across unrelated
 *  assertions. */
export function resetWordCountNoindexTally(): void {
  wordCountNoindexTally = 0;
  exitHandlerRegistered = false;
}

export function getWordCountNoindexTally(): number {
  return wordCountNoindexTally;
}

/**
 * Whether a story's own page should carry noindex. Only word-count hits
 * NOT already explained by source_type get tallied for the build-time
 * summary -- a thin meeting/event/alert is expected and would just
 * inflate the number with non-actionable hits; an unexpectedly thin
 * editorial, essay, or digest is the real signal this safety net exists
 * to catch.
 *
 * A third, independent reason: published_at === null. "Unpublishing" a row
 * (e.g. scripts/scan_contamination.py's quarantine flow, see
 * NEEDS-HUMAN-REVIEW.md) sets published_at back to NULL, but confirmed live
 * 2026-09-03 that nothing in getStaticPaths gates page generation on it --
 * the page still builds and would otherwise stay fully indexable. This is
 * the ONE signal that actually keeps such a row out of Google once it's
 * already been crawled; the listing/homepage queries in lib/db.ts separately
 * filter `published_at IS NOT NULL` to delink it from the front page,
 * archive, and related-content -- see those queries' own comments. Deliberate
 * `=== null` (not `!story.published_at`, which would also strip a real but
 * falsy-looking value) -- see the `published_at?: string | null` widening
 * below, kept narrow so real Story callers (published_at typed as plain
 * `string`, though nullable at runtime) still satisfy it, while tests that
 * omit the field entirely (published_at undefined) are unaffected.
 */
export function shouldNoindexStory(
  story: Pick<Story, 'source_type' | 'body'> & { published_at?: string | null },
): boolean {
  const isThinType = THIN_SCRAPED_SOURCE_TYPES.includes(story.source_type);
  const isThinByWordCount = countWords(story.body) < THIN_CONTENT_WORD_THRESHOLD;
  const isUnpublished = story.published_at === null;
  if (isThinByWordCount && !isThinType) {
    wordCountNoindexTally += 1;
    scheduleWordCountSummaryLog();
  }
  return isThinType || isThinByWordCount || isUnpublished;
}
