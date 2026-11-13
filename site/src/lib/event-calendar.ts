/** Which event pages have an "Add to calendar" .ics file: one rule for s/[slug].ics.ts (builds the file) and s/[slug].astro
 *  (shows the link), so a link never points at a file the build did not make (F18, owner 2026-11-13: Moreno, Brookings and
 *  Glasgow event pages linked /s/<slug>.ics files that were never built, because the page decided on its own end rule and
 *  the file on the upcoming-events query). */
import { getUpcomingStories } from './db';
import type { Story } from './db';
import { hasEnded } from './local-day';
import { siteConfig } from './site-config';

/** Upcoming events read for .ics files. No town is near it (2026-11-13: 52 at most); one past it loses the link, not a file. */
export const EVENT_ICS_LIMIT = 500;

/** True when a calendar file is worth building for this event at `now`: one dated, non-recurring event that has not ended. */
export function canCalendarEvent(story: Story, now: Date, timeZone: string): boolean {
  if (story.source_type !== 'event' || story.is_recurring_series || !story.occurs_at) return false;
  return !hasEnded({ start: new Date(story.occurs_at).toISOString(), end: story.ends_at ? new Date(story.ends_at).toISOString() : null }, now, timeZone);
}

let calendarEvents: Promise<Story[]> | null = null;

/** The events that get a .ics file in this build (read once per build). */
export function getCalendarEvents(): Promise<Story[]> {
  const now = new Date();
  calendarEvents ??= getUpcomingStories(['event'], EVENT_ICS_LIMIT)
    .then((events) => events.filter((e) => canCalendarEvent(e, now, siteConfig.timezone)));
  return calendarEvents;
}

/** Whether the event page for `slug` links a .ics file. */
export async function hasEventCalendar(slug: string): Promise<boolean> {
  return (await getCalendarEvents()).some((e) => e.slug === slug);
}
