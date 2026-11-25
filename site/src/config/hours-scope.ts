/** Places whose doors open for events, not on a weekly schedule (owner order D 6, 2026-11-25). They stay on /facilities/, but
 *  they are left out of the count that decides whether the hub's heading promises hours (lib/facilities-hub.ts
 *  hubPromisesHours): a stadium has no opening hours to have. Slugs per town. */
export const EVENT_VENUES: Record<string, string[]> = {
  // SDSU's stadium, arena and performing arts center (.claude/audit/sources-brookings.md: "Evenemangsdrivna").
  brookings_sd: ['dana-j-dykhouse-stadium', 'first-bank-trust-arena', 'oscar-larson-performing-arts-center'],
  // The amphitheater opens for its events; the park rule does not speak for it (config/park-hours.ts).
  moreno_valley_ca: ['civic-center-amphitheater-park'],
};
