/** Topical authority handoff, Phase 1 -- the cluster resolution helper.
 *  Mirrors the existing `getCityStatus()` / `resolveImage()` /
 *  `resolvePageMeta()` shape: config/clusters.ts holds the data, this file
 *  turns it into a resolved answer for one route key + one town.
 *
 *  Unlike resolvePageMeta() (which throws on an unregistered route key --
 *  a bad call site is always a typo there, since every real page must have
 *  a title), an unregistered route key here is a NORMAL, expected outcome:
 *  the handoff's own text says trust pages and game pages will legitimately
 *  sit outside the graph. `resolveCluster()` returns `null` for those,
 *  never throws -- the graph script (scripts/generate-cluster-graph.ts) is
 *  what decides whether a given null is an expected orphan or a real gap,
 *  since only it has the full page inventory to judge that against.
 */
import { CLUSTERS, CLUSTER_TOWN_OVERRIDES, ROUTE_AVAILABILITY, HUB_HREF, SPOKE_NAV_COPY, type ClusterDefinition, type SpokeNavCopy } from '../config/clusters';
import type { SiteConfig } from './site-config';
import type { BreadcrumbEntry } from './article-jsonld';

export type ClusterRole = 'hub' | 'primary-spoke' | 'secondary-spoke';

export interface ClusterMembership {
  clusterKey: string;
  clusterLabel: string;
  role: ClusterRole;
}

export interface ResolvedClusterInfo {
  /** Exactly one -- the cluster (and role within it) this route counts as
   *  belonging to for breadcrumb/hub-navigation purposes. */
  primary: ClusterMembership;
  /** Zero or more additional clusters this route also surfaces in for
   *  related-link purposes (never breadcrumbs). */
  secondary: ClusterMembership[];
  /** The hub route key of the PRIMARY cluster, already resolved for this
   *  town (i.e. CLUSTER_TOWN_OVERRIDES already applied). */
  hubRoute: string;
  /** Every other spoke (primary + secondary) of the primary cluster that
   *  is actually available for this town, excluding the route itself. */
  siblingSpokes: string[];
}

function hubRouteFor(cluster: ClusterDefinition, townConfig: SiteConfig): string {
  return CLUSTER_TOWN_OVERRIDES[townConfig.townId]?.[cluster.key]?.hubRoute ?? cluster.hubRoute;
}

function isAvailable(routeKey: string, townConfig: SiteConfig): boolean {
  const predicate = ROUTE_AVAILABILITY[routeKey];
  // An unregistered key is never "available" -- see
  // assertClusterConfigConsistency() in the graph script for where a
  // reference like this gets surfaced as a real config problem, not
  // silently treated as just another unavailable route.
  return predicate ? predicate(townConfig) : false;
}

/** One town's fully resolved graph: for every cluster, its (per-town) hub
 *  route and every spoke that's actually available for this town, tagged
 *  with its role. Clusters whose hub isn't available for this town are
 *  omitted entirely -- the handoff's own guardrail ("a cluster whose hub
 *  ... is disabled for a town must not render at all"). Computed once and
 *  reused by both resolveCluster() and the graph script, so the two can
 *  never disagree about what "available" means. */
export interface TownClusterGraph {
  townId: string;
  clusters: {
    key: string;
    label: string;
    hubRoute: string;
    hubAvailable: boolean;
    spokes: { routeKey: string; role: 'primary-spoke' | 'secondary-spoke' }[];
  }[];
}

export function computeTownGraph(townConfig: SiteConfig): TownClusterGraph {
  const clusters: TownClusterGraph['clusters'] = [];

  for (const cluster of Object.values(CLUSTERS)) {
    const hubRoute = hubRouteFor(cluster, townConfig);
    const hubAvailable = isAvailable(hubRoute, townConfig);
    if (!hubAvailable) continue; // whole cluster falls away for this town

    const spokes: TownClusterGraph['clusters'][number]['spokes'] = [];
    for (const routeKey of cluster.primarySpokes) {
      if (isAvailable(routeKey, townConfig)) spokes.push({ routeKey, role: 'primary-spoke' });
    }
    for (const routeKey of cluster.secondarySpokes) {
      if (isAvailable(routeKey, townConfig)) spokes.push({ routeKey, role: 'secondary-spoke' });
    }

    clusters.push({ key: cluster.key, label: cluster.label, hubRoute, hubAvailable, spokes });
  }

  return { townId: townConfig.townId, clusters };
}

/** `routeKey` is whatever `resolvePageMeta()`-style key identifies the
 *  current page (or, for a `story:<sourceType>` group, the caller passes
 *  that synthetic key directly -- there's no per-story-instance call site
 *  yet, this is Phase 1 scaffolding for a Phase 3+ template to use). */
export function resolveCluster(routeKey: string, townConfig: SiteConfig): ResolvedClusterInfo | null {
  const graph = computeTownGraph(townConfig);

  for (const cluster of graph.clusters) {
    if (cluster.hubRoute === routeKey) {
      const siblingSpokes = cluster.spokes.map((s) => s.routeKey);
      return {
        primary: { clusterKey: cluster.key, clusterLabel: cluster.label, role: 'hub' },
        secondary: [],
        hubRoute: cluster.hubRoute,
        siblingSpokes,
      };
    }
  }

  // Primary membership: the FIRST cluster (graph order) where this route
  // is a primary spoke. By design every route in this config has at most
  // one primary-spoke registration -- see
  // assertClusterConfigConsistency() in the graph script, which is what
  // actually enforces that rather than this function silently picking a
  // winner among several.
  let primaryCluster: TownClusterGraph['clusters'][number] | undefined;
  for (const cluster of graph.clusters) {
    if (cluster.spokes.some((s) => s.routeKey === routeKey && s.role === 'primary-spoke')) {
      primaryCluster = cluster;
      break;
    }
  }
  if (!primaryCluster) return null; // a real orphan, or unavailable for this town -- both valid, see caller

  const secondary: ClusterMembership[] = [];
  for (const cluster of graph.clusters) {
    if (cluster.key === primaryCluster.key) continue;
    if (cluster.spokes.some((s) => s.routeKey === routeKey)) {
      secondary.push({ clusterKey: cluster.key, clusterLabel: cluster.label, role: 'secondary-spoke' });
    }
  }

  const siblingSpokes = primaryCluster.spokes
    .map((s) => s.routeKey)
    .filter((r) => r !== routeKey);
  // The hub itself always counts as a sibling to reach from a spoke.
  siblingSpokes.unshift(primaryCluster.hubRoute);

  return {
    primary: { clusterKey: primaryCluster.key, clusterLabel: primaryCluster.label, role: 'primary-spoke' },
    secondary,
    hubRoute: primaryCluster.hubRoute,
    siblingSpokes,
  };
}

export interface ClusterConfigProblem {
  kind: 'dangling-reference' | 'duplicate-primary' | 'too-many-memberships' | 'secondary-without-primary';
  routeKey: string;
  detail: string;
}

/** Pure, town-independent config-consistency checks -- deliberately
 *  DB-free and side-effect-free so this can run in a plain vitest test
 *  (see clusters.test.ts) as well as from the graph script. Three things
 *  page-meta.ts's own "every pattern fits every town" test established as
 *  worth catching automatically rather than finding by hand:
 *
 *    1. Every route key CLUSTERS/CLUSTER_TOWN_OVERRIDES references (as a
 *       hub or a spoke) is actually registered in ROUTE_AVAILABILITY --
 *       the handoff's own "fail loud on a dangling spoke" guardrail.
 *    2. No route key is a PRIMARY spoke of more than one cluster -- the
 *       handoff's own "exactly one primary cluster" rule.
 *    3. No route key has more than two total cluster memberships (hub
 *       counts as one; primary + secondary spoke registrations across all
 *       clusters count together) -- the handoff's own "beyond that the
 *       graph stops meaning anything" cap.
 *    4. No route key is registered as a secondary spoke without also
 *       having a primary home (a hub, or a primary spoke) SOMEWHERE --
 *       resolveCluster() only ever looks for a primary registration
 *       first, so a secondary-only route is silently unreachable (a real
 *       bug this caught while building Phase 2's breadcrumbs -- see
 *       config/clusters.ts's own comment on this rule).
 */
export function validateClusterConfig(): ClusterConfigProblem[] {
  const problems: ClusterConfigProblem[] = [];
  const registered = new Set(Object.keys(ROUTE_AVAILABILITY));

  const checkRef = (routeKey: string, where: string) => {
    if (!registered.has(routeKey)) {
      problems.push({
        kind: 'dangling-reference', routeKey,
        detail: `"${routeKey}" is referenced by ${where} but has no ROUTE_AVAILABILITY entry`,
      });
    }
  };

  const primaryOwners = new Map<string, string[]>(); // routeKey -> cluster keys where it's a hub or primary spoke
  const allMemberships = new Map<string, number>(); // routeKey -> total membership count
  const secondaryOnly = new Set<string>();

  const bump = (routeKey: string) => allMemberships.set(routeKey, (allMemberships.get(routeKey) ?? 0) + 1);
  const addPrimaryOwner = (routeKey: string, clusterKey: string) => {
    const owners = primaryOwners.get(routeKey) ?? [];
    owners.push(clusterKey);
    primaryOwners.set(routeKey, owners);
  };

  for (const cluster of Object.values(CLUSTERS)) {
    checkRef(cluster.hubRoute, `${cluster.key}.hubRoute`);
    bump(cluster.hubRoute);
    addPrimaryOwner(cluster.hubRoute, cluster.key);

    for (const routeKey of cluster.primarySpokes) {
      checkRef(routeKey, `${cluster.key}.primarySpokes`);
      bump(routeKey);
      addPrimaryOwner(routeKey, cluster.key);
    }
    for (const routeKey of cluster.secondarySpokes) {
      checkRef(routeKey, `${cluster.key}.secondarySpokes`);
      bump(routeKey);
      secondaryOnly.add(routeKey);
    }
  }

  for (const routeKey of secondaryOnly) {
    if (!primaryOwners.has(routeKey)) {
      problems.push({
        kind: 'secondary-without-primary', routeKey,
        detail: `"${routeKey}" is registered as a secondary spoke but has no primary home (hub or primary spoke) anywhere -- resolveCluster() would return null for it`,
      });
    }
  }

  for (const [townId, overrides] of Object.entries(CLUSTER_TOWN_OVERRIDES)) {
    for (const [clusterKey, override] of Object.entries(overrides)) {
      if (override?.hubRoute) checkRef(override.hubRoute, `CLUSTER_TOWN_OVERRIDES.${townId}.${clusterKey}.hubRoute`);
    }
  }

  for (const [routeKey, owners] of primaryOwners) {
    if (owners.length > 1) {
      problems.push({
        kind: 'duplicate-primary', routeKey,
        detail: `"${routeKey}" is a hub or primary spoke of more than one cluster: ${owners.join(', ')}`,
      });
    }
  }

  for (const [routeKey, count] of allMemberships) {
    if (count > 2) {
      problems.push({
        kind: 'too-many-memberships', routeKey,
        detail: `"${routeKey}" has ${count} total cluster memberships (max 2)`,
      });
    }
  }

  return problems;
}

/** Topical authority handoff, Phase 2. The single place every spoke page
 *  builds its `breadcrumbTrail` from -- replaces each page's own inline
 *  `[Home, Section, ...]` array literal so the cluster crumb can never be
 *  added to the visible trail (`<Breadcrumbs>`) without also landing in
 *  the JSON-LD (`buildBreadcrumbJsonLd()`), or vice versa: both already
 *  read the SAME array a page builds once, this just centralizes what
 *  that array contains instead of leaving every call site to reimplement
 *  "insert my cluster's hub crumb" by hand.
 *
 *  `page` is the trail's own last entry (current page, not a link) -- the
 *  one piece of information only the call site actually has (its real
 *  label and canonical URL, e.g. a specific facility's own name/slug).
 *
 *  A hub page passes ITSELF here too (matching the existing convention
 *  every hub already follows: `[Home, {label: 'City Hall', href: canonicalUrl}]`)
 *  -- resolveCluster() returns role 'hub' for it, and this deliberately
 *  does NOT insert a redundant middle crumb pointing at the same URL the
 *  last crumb already is.
 *
 *  An orphan (trust page, homepage, an unavailable route for this town)
 *  gets exactly the same two-crumb trail every page already had before
 *  this handoff -- Phase 2 only ever ADDS a middle crumb, never removes
 *  or changes the Home/page ends of the existing trail. */
export function buildClusterBreadcrumbTrail(
  routeKey: string,
  townConfig: SiteConfig,
  page: BreadcrumbEntry,
): BreadcrumbEntry[] {
  const home: BreadcrumbEntry = { label: 'Home', href: '/' };
  const resolved = resolveCluster(routeKey, townConfig);
  if (!resolved || resolved.primary.role === 'hub') {
    return [home, page];
  }

  const hubHref = HUB_HREF[resolved.hubRoute];
  if (!hubHref) {
    // A cluster's hubRoute with no HUB_HREF entry is a config mistake
    // (every real hub route key must have one) -- fail loud rather than
    // silently drop the middle crumb, the same "fails loud" convention as
    // resolvePageMeta()'s own unfilled-placeholder check.
    throw new Error(
      `buildClusterBreadcrumbTrail: no HUB_HREF entry for hub route "${resolved.hubRoute}" ` +
      `(resolving "${routeKey}" for "${townConfig.townId}")`,
    );
  }

  return [home, { label: resolved.primary.clusterLabel, href: hubHref }, page];
}

/** Topical authority handoff, Phase 3. A hub page calls this with its OWN
 *  route key to get the hand-written nav copy (see config/clusters.ts's
 *  `SPOKE_NAV_COPY`) for every spoke that's both available for this town
 *  AND has a real, single-page description registered -- the "detail"
 *  keys (e.g. `facilities/detail`) and `story:<sourceType>` groups have
 *  neither, and are silently skipped
 *  (not an error: not every spoke is a hub-nav candidate, only the ones
 *  with one real page to point at). Order follows the cluster's own
 *  `primarySpokes` array (config authoring order), not spoke-discovery
 *  order, so the block reads the same each build rather than shuffling
 *  with unrelated data changes. Returns `[]` for a route key that isn't a
 *  real hub for this town (including local_life's other two towns' hub
 *  keys) -- the component this feeds renders nothing in that case, same
 *  "absence is normal" convention as every other optional module here. */
export function resolveHubNavItems(hubRouteKey: string, townConfig: SiteConfig): SpokeNavCopy[] {
  const graph = computeTownGraph(townConfig);
  const cluster = graph.clusters.find((c) => c.hubRoute === hubRouteKey);
  if (!cluster) return [];

  const available = new Set(cluster.spokes.map((s) => s.routeKey));
  const definition = CLUSTERS[cluster.key];
  const items: SpokeNavCopy[] = [];
  for (const routeKey of definition.primarySpokes) {
    if (!available.has(routeKey)) continue;
    const copy = SPOKE_NAV_COPY[routeKey];
    if (copy) items.push(copy);
  }
  return items;
}
