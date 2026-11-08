/**
 * Front-page orientation header (Handoff: "Front-page orientation pass",
 * Phase 1). Two lines: a short date, and "What's happening in <Town>
 * today" -- the page's actual H1 (the front page had none before this;
 * the site name in the masthead is an <a>, not a heading).
 *
 * Pure date/timezone math lives here, separate from OrientationHeader.astro,
 * so it's testable without rendering Astro -- see orientation-header.test.ts
 * for the per-timezone fixture this file exists to make possible.
 * Deliberately reuses events.ts's own localDateParts() (the same IANA-
 * timezone-aware conversion already used for event-day bucketing) rather
 * than inventing a second one.
 */
import { localDateParts } from './events';
import { shortDate, localMonthDay } from './calendar-strings';

/** "Wednesday, Sep 9" (us) / "Wednesday, 9 Sep" (gb) -- short month, no year (the year is redundant on a
 *  page that's rebuilt within hours of "today"). */
export function orientationDateLabel(instant: Date, timezone: string, country: 'us' | 'gb' | undefined): string {
  const weekday = instant.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const { m, d } = localMonthDay(instant, timezone);
  return `${weekday}, ${shortDate(m, d, country)}`;
}

/** "2026-09-09" -- the town's own local calendar date, embedded as a data
 *  attribute so the staleness-guard script (inline in
 *  OrientationHeader.astro) can compare it against the VIEWER's current
 *  date in the same timezone without re-deriving the label format. */
export function orientationDateIso(instant: Date, timezone: string): string {
  const { y, m, d } = localDateParts(instant, timezone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
