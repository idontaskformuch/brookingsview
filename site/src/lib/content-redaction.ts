/**
 * 2026-10-02 follow-up: hiding Worker Pulse's STRUCTURED rating/trend
 * display (WorkplaceWatchWidget.astro, workplace-watch/index.astro's own
 * table columns) turned out not to be enough -- grepping the real built
 * output (HTML, RSS, JSON-LD) found the AI-generated theme_summary PROSE
 * itself routinely restates the exact same numbers in sentence form
 * ("rate the company 2.9 out of 5 stars on Glassdoor", "received 2.4 out
 * of 5 stars across 39 reviews"). That text is `stories.body` for a
 * workplace_watch_digest row (ai_pipeline/workplace_watch_digest.py writes
 * the identical string into both stories.body and employer_ratings.theme_summary),
 * and it feeds every page/feed that renders a story's body verbatim: the
 * individual /s/<slug>/ digest page (meta description, visible paragraph,
 * JSON-LD articleBody -- see [slug].astro), the /workplace-watch/ listing
 * table's own excerpt, and rss.xml. One shared function here instead of
 * three separate inline checks, so the redaction can't silently diverge
 * between them (or get missed entirely on a fourth future call site).
 *
 * A placeholder NOTE, not a regex trying to strip just the numbers out of
 * otherwise-free-form AI prose -- the sentence shapes vary too much
 * ("rated 3.1 out of 5", "range from 3.5 to 3.9 out of 5 stars", "2.4 out
 * of 5 stars across 39 reviews") for a pattern-based redaction to be
 * trustworthy, and a half-redacted sentence ("a warehouse rated out of 5")
 * reads worse than an honest placeholder.
 */
import type { SourceType } from './db';

const WORKER_PULSE_WITHHELD_NOTE = (
  "This employer's review-theme summary is temporarily withheld while " +
  "sourcing is reviewed against Glassdoor's and Indeed's own terms of use " +
  "-- see /workplace-watch/ for why. Hiring data, where available, is unaffected."
);

/** Returns `body` unchanged for every source_type except
 *  workplace_watch_digest, which gets the shared withheld-note placeholder
 *  instead -- see module docstring. */
export function redactWorkerPulseBody(sourceType: SourceType | string, body: string): string {
  return sourceType === 'workplace_watch_digest' ? WORKER_PULSE_WITHHELD_NOTE : body;
}
