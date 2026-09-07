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
 *
 * The "UNMAPPED VENUES" section within --include-ticketmaster (What's On
 * Phase 5 follow-up, "Radius Fix" review) exists because the invisible
 * version of exactly this problem is what shipped Phase 5's own Marquee
 * section inverted the first time: every uncurated venue silently lands at
 * the default (lowest) tier with no signal anywhere that it happened, so a
 * newly-arrived arena or a renamed one degrades ranking quality with no
 * review-time indication anything is wrong. This is a REVIEW-time visibility
 * aid only, never a build failure -- an unmapped venue must keep working
 * (falling back to the default tier) exactly as before, just visibly now.
 */
import { getUpcomingStories, getUpcomingArtsEvents } from '../src/lib/db';
import { siteConfig } from '../src/lib/site-config';
import { buildEventFeed, itemTitle, itemVenue } from '../src/lib/events';
import { rankEvents } from '../src/lib/event-ranking';
import { fetchTicketmasterEvents } from '../src/lib/ticketmaster';
import { venueTierFor, isVenueCurated, DEFAULT_VENUE_TIER } from '../src/lib/venue-tiers';

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

    const unmapped = new Map<string, { name: string; count: number }>();
    for (const item of tmItems) {
      const e = item.ticketmasterEvent;
      const date = item.occurs_at ? new Date(item.occurs_at).toISOString().slice(0, 16).replace('T', ' ') : '(undated)';
      const tier = venueTierFor(siteConfig.townId, e.venueName, e.venueId);
      const venue = (e.venueName ?? '(none)').slice(0, 45).padEnd(45);
      console.log(`${date.padEnd(21)}  ${tier.padEnd(7)} ${venue}  ${e.title}`);
      console.log(`  image: ${e.imageUrl ?? '(none)'}`);
      console.log(`  price: ${e.priceRangeText ?? '(none)'}`);

      // NOT `tier === DEFAULT_VENUE_TIER` -- a venue can be deliberately
      // curated AS the default tier (BIGS Sports Bar, 'small'), which that
      // comparison can't distinguish from a genuinely uncurated venue that
      // merely fell through to it. Confirmed live: the first version of
      // this check wrongly flagged BIGS Sports Bar as unmapped. See
      // isVenueCurated()'s own comment in lib/venue-tiers.ts.
      if (!isVenueCurated(siteConfig.townId, e.venueName, e.venueId) && e.venueName) {
        const key = e.venueId ?? e.venueName;
        const existing = unmapped.get(key);
        unmapped.set(key, { name: e.venueName, count: (existing?.count ?? 0) + 1 });
      }
    }
    console.log();

    if (unmapped.size > 0) {
      console.log('='.repeat(78));
      console.log(`⚠️  UNMAPPED VENUES -- ${unmapped.size} venue(s) landed at the default ('${DEFAULT_VENUE_TIER}') tier`);
      console.log('   with no curated entry in lib/venue-tiers.ts. Review whether each one');
      console.log('   deserves a real tier -- see venue-tiers.ts\'s VENUE_TIERS_BY_ID for how to');
      console.log('   add one (real, checked capacity data, not a guess).');
      console.log('='.repeat(78));
      for (const { name, count } of unmapped.values()) {
        console.log(`   ${String(count).padStart(3)} event(s) -- ${name}`);
      }
      console.log('='.repeat(78));
      console.log();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
