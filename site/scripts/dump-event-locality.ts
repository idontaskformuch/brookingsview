/**
 * Phase 2, item 2a verification (2026-10-08) -- dev-only inspection tool,
 * same pattern as scripts/dump-event-ranking.ts: NOT wired into the build,
 * no committed artifact. Runs the real classifyEventLocality() pipeline
 * against LIVE data for whichever town SITE_CITY names, so a human can
 * manually check the in_town/nearby/unknown calls and the weekend-hero
 * counts against the real source pages before trusting them.
 *
 * Usage (from site/):
 *   SITE_CITY=brookings_sd npx vite-node --config vite-node.config.ts scripts/dump-event-locality.ts
 */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities } from '../src/lib/db';
import { siteConfig } from '../src/lib/site-config';
import { buildEventFeed, itemTitle, itemVenue, classifyEventLocality, weekendAnchorOffset, dayIndex, todayUtcMidnight } from '../src/lib/events';

async function main() {
  const [stories, artsEvents, facilities] = await Promise.all([
    getUpcomingStories(['event'], 200),
    getUpcomingArtsEvents(200),
    getFacilities(),
  ]);

  const { items } = buildEventFeed(stories, artsEvents, siteConfig.timezone);
  const today = todayUtcMidnight(siteConfig.timezone);
  const anchor = weekendAnchorOffset(today);

  const classified = items.map((item) => ({
    item,
    offset: item.occurs_at ? dayIndex(item.occurs_at, today, siteConfig.timezone) : null,
    ...classifyEventLocality(item, facilities, siteConfig.townId, siteConfig.cityName, siteConfig.townCenter),
  }));

  console.log(`\n${siteConfig.cityName} (${siteConfig.townId}) -- ${items.length} upcoming event(s), today = ${today.toISOString().slice(0, 10)}, weekend anchor offset = ${anchor}\n`);
  console.log('date                  dayIdx  zone      dist   source   venue                                     title');
  console.log('-'.repeat(150));

  // Mirrors events.astro's real weekend-hero math exactly: only in_town
  // items count, same as `inTownItems` there.
  const inTown = classified.filter((c) => c.zone === 'in_town');
  const friCount = inTown.filter((c) => c.offset === anchor).length;
  const satCount = inTown.filter((c) => c.offset === anchor + 1).length;
  const sunCount = inTown.filter((c) => c.offset === anchor + 2).length;

  for (const { item, offset, zone, distanceMiles } of classified.slice(0, 20)) {
    const date = item.occurs_at ? new Date(item.occurs_at).toISOString().slice(0, 16).replace('T', ' ') : '(undated)';
    const offsetStr = offset === null ? '?' : String(offset);
    const dist = distanceMiles != null ? `${distanceMiles.toFixed(1)}mi` : '-';
    const source = item.sourceKind;
    const venue = (itemVenue(item) ?? '(none)').slice(0, 40).padEnd(40);
    console.log(
      `${date.padEnd(21)} ${offsetStr.padStart(6)}  ${zone.padEnd(8)}  ${dist.padStart(6)}  ${source.padEnd(7)}  ${venue}  ${itemTitle(item)}`,
    );
  }

  const nearbyCount = classified.filter((c) => c.zone === 'nearby').length;
  const unknownCount = classified.filter((c) => c.zone === 'unknown').length;
  console.log(`\nWeekend hero (in_town only, FULL upcoming list not just the 20-row sample above): Fri ${friCount} · Sat ${satCount} · Sun ${sunCount} (anchor offset ${anchor})`);
  console.log(`Locality totals (full list): in_town ${inTown.length} · nearby ${nearbyCount} · unknown/excluded ${unknownCount}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
