/**
 * Topical authority handoff, Phase 1 -- "graph only, no rendering." Emits
 * the resolved cluster graph for the current SITE_CITY town to
 * ../reports/cluster-graph-<town_id>.json (repo-root reports/, same
 * location scripts/audit_page_metadata.mjs already writes to). Review this
 * before any template changes -- Phase 2 (breadcrumbs) waits on it.
 *
 * Needs Vite's module resolution and import.meta.env (lib/db.ts,
 * lib/site-config.ts) -- a plain `node` invocation can't provide that,
 * hence `vite-node`, same reason dump-event-ranking.ts already needs it.
 *
 * Usage (from site/):
 *   SITE_CITY=brookings_sd npm run cluster-graph
 *   SITE_CITY=moreno_valley_ca npm run cluster-graph
 *   SITE_CITY=broomfield_co npm run cluster-graph
 *
 * Always exits 0 -- like audit_page_metadata.mjs, this is a measurement
 * tool for human review, not a gate. Phase 1 has no build-time check yet;
 * that's the whole point of stopping here for review first.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { siteConfig } from '../src/lib/site-config';
import { computeTownGraph, validateClusterConfig } from '../src/lib/clusters';
import { ROUTE_AVAILABILITY } from '../src/config/clusters';
import { getFacilities, getProjects, getContentByType, type SourceType } from '../src/lib/db';

/** Every real page file in src/pages, classified by hand against its own
 *  actual gate logic (not assumed) -- see NEEDS-HUMAN-REVIEW.md's Phase 1
 *  entry for the full per-file audit this was built from. `routeKey: null`
 *  is a DELIBERATE, DOCUMENTED non-member, not an oversight -- the
 *  handoff's own text expects trust pages and game-adjacent system pages
 *  to legitimately sit outside the graph. */
interface PageRegistryEntry {
  file: string;
  routeKey: string | null;
  expectedOrphanReason?: string;
}

const PAGE_REGISTRY: PageRegistryEntry[] = [
  { file: '404.astro', routeKey: null, expectedOrphanReason: 'system (error page)' },
  { file: 'about.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'advertising.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'burro-bonanza.astro', routeKey: 'burro-bonanza' },
  { file: 'city-hall.astro', routeKey: 'city-hall' },
  { file: 'city-hall/archive.astro', routeKey: 'city-hall/archive' },
  { file: 'city-hall/projects/[slug].astro', routeKey: 'city-hall/projects/detail' },
  { file: 'city-hall/projects/index.astro', routeKey: 'city-hall/projects' },
  { file: 'closures.astro', routeKey: 'closures' },
  { file: 'columns.astro', routeKey: 'columns' },
  { file: 'contact.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'cookies.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'corrections.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'editorial-policy.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'editorials.astro', routeKey: 'editorials' },
  { file: 'events.astro', routeKey: 'events' },
  { file: 'events/[facet].astro', routeKey: 'events/facet' },
  { file: 'events/past.astro', routeKey: 'events/past' },
  { file: 'facilities/[slug].astro', routeKey: 'facilities/detail' },
  { file: 'facilities/index.astro', routeKey: 'facilities' },
  { file: 'farm-report.astro', routeKey: 'farm-report' },
  { file: 'home-sales.astro', routeKey: 'home-sales' },
  { file: 'home-sales/[slug].astro', routeKey: 'home-sales/detail' },
  { file: 'home-sales/archive.astro', routeKey: 'home-sales/archive' },
  { file: 'home-sales/zip/[zip].astro', routeKey: 'home-sales/zip' },
  { file: 'how-we-gather-this.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'index.astro', routeKey: null, expectedOrphanReason: 'homepage -- aggregates every cluster, not a member of one' },
  { file: 'jackrabbits.astro', routeKey: 'jackrabbits' },
  { file: 'jobs.astro', routeKey: 'jobs' },
  { file: 'jobs/category/[category].astro', routeKey: 'jobs/category' },
  { file: 'new-in-town.astro', routeKey: null, expectedOrphanReason: 'feature dark for every town today (no hasNewInTown:true anywhere in site-config.ts)' },
  { file: 'offline.astro', routeKey: null, expectedOrphanReason: 'system (PWA offline fallback)' },
  { file: 'play.astro', routeKey: 'play' },
  { file: 'privacy.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'recipes.astro', routeKey: 'recipes' },
  { file: 'reviews.astro', routeKey: 'reviews' },
  { file: 's/[slug].astro', routeKey: null, expectedOrphanReason: 'shared dynamic template behind every story:<sourceType> group -- not a route key of its own' },
  { file: 'sports.astro', routeKey: 'sports' },
  { file: 'terms.astro', routeKey: null, expectedOrphanReason: 'trust page' },
  { file: 'this-week/[week].astro', routeKey: 'this-week' },
  { file: 'this-week/index.astro', routeKey: null, expectedOrphanReason: 'pure redirect stub, zero rendered content (correctly excluded from the metadata handoff too)' },
  { file: 'today.astro', routeKey: 'today' },
  { file: 'traffic.astro', routeKey: 'traffic' },
  { file: 'university.astro', routeKey: 'university' },
  { file: 'vail-resorts.astro', routeKey: 'vail-resorts' },
  { file: 'weather.astro', routeKey: 'weather' },
  { file: 'whats-on/[slug].astro', routeKey: 'whats-on/detail' },
  { file: 'whats-on/index.astro', routeKey: 'whats-on' },
  { file: 'workplace-watch/index.astro', routeKey: 'workplace-watch' },
];

const STORY_GROUP_SOURCE_TYPES: Record<string, SourceType[]> = {
  'story:meeting': ['meeting'],
  'story:meeting_followup': ['meeting_followup'],
  'story:event': ['event'],
  'story:alert': ['alert'],
  'story:weekly': ['weekly'],
  'story:workplace_watch_digest': ['workplace_watch_digest'],
  'story:home_sales_digest': ['home_sales_digest'],
};

/** Real-data existence probe for a dynamic/instance-group route key --
 *  cheap (limit 1 for stories), not a full count. `null` = not an
 *  instance-group key at all (a static page's "existence" is just "the
 *  file is in PAGE_REGISTRY", not a DB question). */
async function realInstanceCount(routeKey: string): Promise<number | null> {
  if (routeKey in STORY_GROUP_SOURCE_TYPES) {
    const rows = await getContentByType(STORY_GROUP_SOURCE_TYPES[routeKey], 1);
    return rows.length;
  }
  if (routeKey === 'facilities/detail') return (await getFacilities()).length;
  if (routeKey === 'city-hall/projects/detail') return (await getProjects()).length;
  return null;
}

async function main() {
  const configProblems = validateClusterConfig();
  const graph = computeTownGraph(siteConfig);

  const referencedRouteKeys = new Set<string>();
  for (const cluster of graph.clusters) {
    referencedRouteKeys.add(cluster.hubRoute);
    for (const spoke of cluster.spokes) referencedRouteKeys.add(spoke.routeKey);
  }

  // Real-data existence probes for every dynamic key this town's graph
  // actually references -- catches "config says available, real data says
  // otherwise" quietly, without needing a full astro build first.
  const instanceCounts: Record<string, number> = {};
  for (const routeKey of referencedRouteKeys) {
    const count = await realInstanceCount(routeKey);
    if (count !== null) instanceCounts[routeKey] = count;
  }
  const emptyButAvailable = Object.entries(instanceCounts)
    .filter(([, count]) => count === 0)
    .map(([routeKey]) => routeKey);

  // Dangling references: a route key this town's graph resolved as
  // available that corresponds to NEITHER a real page file NOR a known
  // instance-group probe. Shouldn't be reachable given how
  // ROUTE_AVAILABILITY was built, but this is the actual guardrail the
  // handoff asks for -- checked against real data, not assumed safe.
  const knownRouteKeys = new Set([
    ...PAGE_REGISTRY.filter((e) => e.routeKey !== null).map((e) => e.routeKey as string),
    ...Object.keys(STORY_GROUP_SOURCE_TYPES),
  ]);
  const danglingReferences = [...referencedRouteKeys].filter((k) => !knownRouteKeys.has(k));

  // Documented orphans: every real page file this graph deliberately
  // doesn't cover, with the reason on record.
  const documentedOrphans = PAGE_REGISTRY
    .filter((e) => e.routeKey === null)
    .map((e) => ({ file: e.file, reason: e.expectedOrphanReason ?? '(undocumented -- fix PAGE_REGISTRY)' }));

  // Stranded pages: a registered route key that DOES render for this town
  // (its own ROUTE_AVAILABILITY predicate is true) but isn't reachable
  // through this town's graph because its cluster's hub is disabled here
  // -- a real, worth-reviewing finding, not a bug in either direction. The
  // /jobs/ page for Brookings is the known example: jobs.astro has no gate
  // of its own, but work_and_money's hub (workplace-watch) is dark for
  // Brookings, so the whole cluster (and /jobs/ along with it) drops out
  // of Brookings' graph even though the page itself renders fine.
  const strandedPages = PAGE_REGISTRY
    .filter((e) => e.routeKey !== null)
    .filter((e) => {
      const predicate = ROUTE_AVAILABILITY[e.routeKey as string];
      const rendersHere = predicate ? predicate(siteConfig) : false;
      return rendersHere && !referencedRouteKeys.has(e.routeKey as string);
    })
    .map((e) => ({ file: e.file, routeKey: e.routeKey as string }));

  const report = {
    townId: siteConfig.townId,
    generatedAt: new Date().toISOString(),
    clusters: graph.clusters.map((c) => ({
      key: c.key,
      label: c.label,
      hubRoute: c.hubRoute,
      spokes: c.spokes,
    })),
    instanceCounts,
    emptyButAvailable,
    documentedOrphans,
    strandedPages,
    danglingReferences,
    configProblems,
  };

  mkdirSync('../reports', { recursive: true });
  const outPath = `../reports/cluster-graph-${siteConfig.townId}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  console.log(
    `[${siteConfig.townId}] ${graph.clusters.length} cluster(s) render, ` +
    `${documentedOrphans.length} documented orphan(s), ${strandedPages.length} stranded page(s), ` +
    `${emptyButAvailable.length} empty-but-available group(s), ${danglingReferences.length} dangling reference(s), ` +
    `${configProblems.length} config problem(s) -- wrote ${outPath}`,
  );
  if (danglingReferences.length > 0) console.warn(`  DANGLING: ${danglingReferences.join(', ')}`);
  if (configProblems.length > 0) console.warn(`  CONFIG PROBLEMS: ${configProblems.map((p) => p.detail).join(' | ')}`);
  if (strandedPages.length > 0) console.warn(`  STRANDED: ${strandedPages.map((s) => `${s.routeKey} (${s.file})`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
