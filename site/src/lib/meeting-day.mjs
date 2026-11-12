/**
 * The town's own calendar day of a meeting -- stories.occurs_at for source_type 'meeting'/'meeting_followup' and
 * project_updates.meeting_date (copied from meetings.meeting_date). One rule, shared by lib/this-week.ts, lib/week-count.mjs
 * (so astro.config.mjs's sitemap filter, which cannot import site-config, uses it too) and components/meetings/ArchivePage.astro:
 *
 *   meetingsHaveTime = false (Brookings/Legistar): a bare calendar date stored at UTC midnight (or noon) -- read the UTC Y/M/D,
 *     no timezone conversion (in America/Chicago UTC midnight is the previous evening).
 *   meetingsHaveTime = true (Broomfield AgendaLink, Moreno eSCRIBE, Glasgow): a real instant -- read it in the town's zone.
 *     The UTC date is the NEXT day for every evening meeting west of UTC (live 2026-11-12: Broomfield's council meeting Tue
 *     Nov 10 6pm MST = 2026-11-11T01:00Z sat under "Wed Nov 11" on /this-week/).
 *
 * No imports, like week-count.mjs. Types: meeting-day.d.mts.
 */

/** { y, m (1-12), d } of the meeting's local day, or null without a date. */
export function meetingDayParts(value, timezone, meetingsHaveTime) {
  if (value == null || value === '') return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  if (!meetingsHaveTime) {
    return { y: instant.getUTCFullYear(), m: instant.getUTCMonth() + 1, d: instant.getUTCDate() };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** "YYYY-MM-DD" of the meeting's local day, or null without a date. */
export function meetingDayKey(value, timezone, meetingsHaveTime) {
  const p = meetingDayParts(value, timezone, meetingsHaveTime);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
