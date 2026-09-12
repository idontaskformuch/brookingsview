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
import { CLUSTERS, CLUSTER_TOWN_OVERRIDES, ROUTE_AVAILABILITY, type ClusterDefinition } from '../config/clusters';
import type { SiteConfig } from './site-config';

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
  kind: 'dangling-reference' | 'duplicate-primary' | 'too-many-memberships';
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
