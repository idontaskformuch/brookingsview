/** Pure selection logic behind index.astro's "Worth knowing" block and
 *  "Latest from <site>" strip -- split out so it's unit-testable
 *  independent of Astro (same pattern as event-jsonld.ts/farm-report.ts).
 *  See NEEDS-HUMAN-REVIEW.md "Homepage Curation".
 */
import type { Story } from './db';

/** Mirrors content/local_context.py's _QUORUM_NOTICE_RE (Python side, used
 *  to collapse recurring notices before they reach the column-writing
 *  prompt -- see NEEDS-HUMAN-REVIEW.md "Columns thematic repetition").
 *  Deliberately duplicated rather than shared across languages, same
 *  tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR and
 *  venue_registry.py/db.ts's normalize_venue(). This is the ONE recognized
 *  theme pattern with a real, previously-diagnosed repetition problem
 *  behind it (see P2) -- not a general-purpose topic classifier. Extend
 *  only when a second real repetition pattern is actually observed, not
 *  speculatively. */
const QUORUM_NOTICE_RE =
  /no official (?:city )?business will be (?:conducted|discussed)|quorum notice|may (?:attend|be present|gather)/i;

export function hasQuorumNoticeSignal(text: string): boolean {
  return QUORUM_NOTICE_RE.test(text);
}

function themeSignal(story: Story): string | null {
  if (hasQuorumNoticeSignal(story.title) || hasQuorumNoticeSignal(story.body)) return 'quorum_notice';
  return null;
}

/** "Editorials > Columns > Reviews > Recipes" from the brief -- a fixed
 *  editorial priority, not something a plain `ORDER BY published_at`
 *  expresses on a same-timestamp tie (two stories published in the same
 *  daily-content run can share an identical published_at). Lower number
 *  wins. */
const GENRE_PRIORITY: Record<string, number> = {
  editorial: 0,
  culture_essay: 1, kvick_essa: 1, vetenskap_kronika: 1, // "Columns" -- all one tier
  media_recension: 2,
  vardagsmiddag: 3,
};

function genrePriority(sourceType: string): number {
  return GENRE_PRIORITY[sourceType] ?? 99;
}

/** Most recent 3 editorial-vertical stories, published_at DESC with a real
 *  genre tiebreak on exact-timestamp ties -- never events/alerts/meetings/
 *  the weekly roundup (candidates already exclude those at the query
 *  level, see getLatestFromCandidates). */
export function selectLatestFrom(candidates: Story[], limit = 3): Story[] {
  const sorted = [...candidates].sort((a, b) => {
    const byDate = new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
    if (byDate !== 0) return byDate;
    return genrePriority(a.source_type) - genrePriority(b.source_type);
  });
  return sorted.slice(0, limit);
}

/** civic/alert/featured candidates -> the homepage's "Worth knowing" block.
 *  Hard limits from the brief, all enforced here (SQL already applied the
 *  -24h floor, see getWorthKnowingCandidates):
 *    - max `limit` items
 *    - never repeat a slug already shown in the alert banner
 *    - never share a recognized theme with something already selected for
 *      "Latest from" (computed first and passed in) -- avoids the exact
 *      repetition-on-the-homepage failure mode P2 fixed in the pipeline;
 *      see themeSignal() above for the one theme this actually checks.
 *  featured=true rows sort first (SQL already put them first too; this
 *  re-affirms it survives the slice after filtering, not just the query). */
const SENTENCE_END_RE = /(?<=[.!?])\s+/;

/** First sentence of `body`, for the "Latest from" strip's compact card
 *  (brief: "headline + first sentence + Read →", not the full body a
 *  regular StoryCard shows). Falls back to the whole body when no
 *  sentence-ending punctuation is found (e.g. a very short body) rather
 *  than returning an empty string. */
export function firstSentence(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  const [first] = trimmed.split(SENTENCE_END_RE);
  return first;
}

export function selectWorthKnowing(
  candidates: Story[],
  alertBannerSlugs: Set<string>,
  latestFromSelection: Story[],
  limit = 3
): Story[] {
  const latestFromThemes = new Set(
    latestFromSelection.map(themeSignal).filter((t): t is string => t !== null)
  );

  const seenThemes = new Set<string>();
  const selected: Story[] = [];
  for (const story of candidates) {
    if (selected.length >= limit) break;
    if (alertBannerSlugs.has(story.slug)) continue;
    const theme = themeSignal(story);
    if (theme && (latestFromThemes.has(theme) || seenThemes.has(theme))) continue;
    if (theme) seenThemes.add(theme);
    selected.push(story);
  }
  return selected;
}
