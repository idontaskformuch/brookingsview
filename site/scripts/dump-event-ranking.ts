/**
 * What's On Phase 2 -- dev-only inspection tool. NOT wired into the build,
 * not a public page or route, produces no committed artifact.
 *
 * Runs the real pipeline (buildEventFeed -> venue tier lookup -> rankEvents)
 * against LIVE data for whichever town SITE_CITY names, and prints a
 * readable dump so a human can sanity-check the ordering before Phase 5
 * ever renders it anywhere.
 *
 * Needs Vite's module resolution and import.meta.env (lib/db.ts reads
 * import.meta.env.DATABASE_URL at module scope) -- a plain `node` or
 * `ts-node` invocation can't provide that, hence `vite-node` (see this
 * package's devDependencies).
 *
 * Usage (from site/):
 *   SITE_CITY=brookings_sd npm run dump-ranking
 *   SITE_CITY=brookings_sd npm run dump-ranking -- --include-ticketmaster
 *
 * Brookings is the only town with real arts_culture data today (Phase 2
 * runs entirely against it) -- another SITE_CITY will just print an empty
 * dump, not an error.
 *
 * --include-ticketmaster (What's On Phase 3): a SEPARATE section, printed
 * after the main ranked table, calling fetchTicketmasterEvents() directly
 * -- bypassing siteConfig.ticketmaster?.enabled on purpose, since this flag
 * exists specifically for manual review of the adapter independent of the
 * (deliberately false) production flag. Omitted entirely by default so a
 * plain `npm run dump-ranking` behaves exactly as it did in Phase 2.
 */
import { getUpcomingStories, getUpcomingArtsEvents } from '../src/lib/db';
import { siteConfig } from '../src/lib/site-config';
import { buildEventFeed, itemTitle, itemVenue } from '../src/lib/events';
import { rankEvents } from '../src/lib/event-ranking';
import { fetchTicketmasterEvents } from '../src/lib/ticketmaster';
import { venueTierFor } from '../src/lib/venue-tiers';

async function main() {
  const [stories, artsEvents] = await Promise.all([
    getUpcomingStories(['event'], 200),
    getUpcomingArtsEvents(200),
  ]);

  const feed = buildEventFeed(stories, artsEvents, siteConfig.timezone);
  const ranked = rankEvents(feed, siteConfig.townId);

  console.log(`\n${siteConfig.cityName} (${siteConfig.townId}) -- ${ranked.length} upcoming event(s)\n`);
  console.log(
    'rank  score  venue-tier  cross  date                  venue                                          title',
  );
  console.log('-'.repeat(140));

  ranked.forEach((r, i) => {
    // occurs_at is typed string | null, but the DB driver hands back a
    // native Date for timestamptz columns at runtime -- normalize via
    // `new Date()` rather than assuming .slice() works on it directly.
    const date = r.item.occurs_at ? new Date(r.item.occurs_at).toISOString().slice(0, 16).replace('T', ' ') : '(undated)';
    const venue = (itemVenue(r.item) ?? '(none)').slice(0, 45).padEnd(45);
    console.log(
      `${String(i + 1).padStart(4)}  ${String(r.score).padStart(5)}  ${r.venueTier.padEnd(10)}  ` +
      `${String(r.crossMatchCount).padStart(5)}  ${date.padEnd(21)}  ${venue}  ${itemTitle(r.item)}`,
    );
  });

  console.log(
    `\nscore = venueTier(${'small=0/medium=1/large=2'}) * 10 + crossMatchCount * 5\n`,
  );

  if (process.argv.includes('--include-ticketmaster')) {
    if (!siteConfig.ticketmaster) {
      console.log(`\n${siteConfig.cityName} has no ticketmaster config (latitude/longitude/radiusMiles) -- skipping.\n`);
      return;
    }
    const { latitude, longitude, radiusMiles } = siteConfig.ticketmaster;
    console.log(`\n--- Ticketmaster (Discovery API, live fetch, siteConfig.ticketmaster.enabled bypassed) ---\n`);
    const tmItems = await fetchTicketmasterEvents(latitude, longitude, radiusMiles);
    console.log(`Fetched ${tmItems.length} Ticketmaster event(s) within ${radiusMiles}mi of ${siteConfig.cityName} (${latitude},${longitude})\n`);
    console.log('date                  tier    venue                                          title (-> image/price)');
    console.log('-'.repeat(140));
    for (const item of tmItems) {
      const e = item.ticketmasterEvent;
      const date = item.occurs_at ? new Date(item.occurs_at).toISOString().slice(0, 16).replace('T', ' ') : '(undated)';
      const tier = venueTierFor(siteConfig.townId, e.venueName);
      const venue = (e.venueName ?? '(none)').slice(0, 45).padEnd(45);
      console.log(`${date.padEnd(21)}  ${tier.padEnd(7)} ${venue}  ${e.title}`);
      console.log(`  image: ${e.imageUrl ?? '(none)'}`);
      console.log(`  price: ${e.priceRangeText ?? '(none)'}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
