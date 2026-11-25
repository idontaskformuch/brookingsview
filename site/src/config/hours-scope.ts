/** Places whose doors open for events, not on a weekly schedule (owner order D 6, 2026-11-25). They stay on /facilities/, but
 *  they are left out of the count that decides whether the hub's heading promises hours (lib/facilities-hub.ts
 *  hubPromisesHours): a stadium has no opening hours to have. Slugs per town. */
export const EVENT_VENUES: Record<string, string[]> = {
  // SDSU's stadium, arena and performing arts center (.claude/audit/sources-brookings.md: "Evenemangsdrivna").
  brookings_sd: ['dana-j-dykhouse-stadium', 'first-bank-trust-arena', 'oscar-larson-performing-arts-center'],
  // The amphitheater opens for its events; the park rule does not speak for it (config/park-hours.ts).
  moreno_valley_ca: ['civic-center-amphitheater-park'],
};

/** Places whose place_hours rows are not confirmed by any source (owner order D, 2026-11-25): the rows stay in the database
 *  but the site reads none of them (lib/db.ts getAllPlaceHoursForTown/getPlaceHours), so there is no weekly line and no
 *  open/closed pill until a source confirms them and the slug is taken off this list. Slugs per town. */
export const UNCONFIRMED_HOURS: Record<string, Record<string, { reason: string; confirmWith: string }>> = {
  broomfield_co: {
    // Rows Mon-Fri 10-18 entered by hand 2026-11-13; the source page has no hours (log 2026-11-25 Order D, facility_hours
    // broomfield-departments).
    'broomfield-auditorium': {
      reason: 'Mon-Fri 10 a.m.-6 p.m. entered by hand; https://www.broomfield.org/243/Rent-the-Auditorium lists no hours',
      confirmWith: 'https://www.broomfield.org/243/Rent-the-Auditorium',
    },
  },
};

/** The slugs in this town whose place_hours rows the site must not read. */
export function unconfirmedHoursSlugs(townId: string): string[] {
  return Object.keys(UNCONFIRMED_HOURS[townId] ?? {});
}
