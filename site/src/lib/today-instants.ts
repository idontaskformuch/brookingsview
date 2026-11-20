/** The entries the header ticker counts ("N events today · +M nearby", BaseLayout): the SAME pipeline as /today/ and /events/
 *  (events-town-view.ts buildTownEntries), counted in the browser by lib/local-day.ts countEventsToday() -- the one definition
 *  (Designsystem Fas 2, owner 2026-11-20). Only entries with a time in the next three town days travel to the page. */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities } from './db';
import { buildTownEntries, countableEntries } from './events-town-view';
import type { CountableEntry } from './local-day';

const SOON_MS = 3 * 86_400_000;
let cached: Promise<CountableEntry[]> | null = null;

export function getTodayEntries(): Promise<CountableEntry[]> {
  cached ??= (async () => {
    const [stories, arts, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
    const now = new Date();
    return countableEntries(buildTownEntries(stories, arts, facilities, now))
      .filter((e) => e.occ.some((o) => Date.parse(o.start) - now.getTime() < SOON_MS));
  })();
  return cached;
}
