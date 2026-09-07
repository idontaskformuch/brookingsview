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
 *
 * Brookings is the only town with real arts_culture data today (Phase 2
 * runs entirely against it) -- another SITE_CITY will just print an empty
 * dump, not an error.
 */
import { getUpcomingStories, getUpcomingArtsEvents } from '../src/lib/db';
import { siteConfig } from '../src/lib/site-config';
import { buildEventFeed, itemTitle, itemVenue } from '../src/lib/events';
import { rankEvents } from '../src/lib/event-ranking';

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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
