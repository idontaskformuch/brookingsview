/** Old event permalinks are not built (Actions minutes, owner 2026-10-28; the data stays in the database).
 *
 *  Every /s/event-N/ page is noindex by type (lib/noindex.ts) and a finished event is worth nothing to a reader a couple
 *  of months on; Moreno alone builds thousands of them. An event whose last moment is more than PRUNE_EVENT_AFTER_DAYS
 *  ago gets no page. The Worker answers a request for such a URL with a 301 to /events/past/ (server/pruned-events.ts),
 *  and /events/past/ lists the event by title and date without a link to the page that no longer exists.
 *
 *  Never pruned: anything that is not an event, a recurring series (its occurs_at is only the date it was first seen),
 *  and an event with no date (nothing says it is old). */
import type { Story } from './db';

export const PRUNE_EVENT_AFTER_DAYS = 30; // owner 2026-10-28 (was 60)

type Prunable = Pick<Story, 'source_type' | 'occurs_at'> & { ends_at?: string | null; is_recurring_series?: boolean };

export function isPrunedEvent(story: Prunable, now: Date = new Date()): boolean {
  if (story.source_type !== 'event' || story.is_recurring_series) return false;
  const last = story.ends_at ?? story.occurs_at;
  if (!last) return false;
  return now.getTime() - new Date(last).getTime() > PRUNE_EVENT_AFTER_DAYS * 24 * 3600 * 1000;
}
