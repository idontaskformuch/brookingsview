/** Topical authority handoff, Phase 1 -- the cluster graph config.
 *  `site/src/lib/clusters.ts`'s `resolveCluster()` reads this. Mirrors the
 *  existing "config + resolver" shape (`getCityStatus()` / `resolveImage()`
 *  / `resolvePageMeta()`): data lives here, the lib function turns it into
 *  a resolved answer for one route + one town.
 *
 *  PHASE 1 ONLY. No template touches this yet -- see
 *  scripts/generate-cluster-graph.ts, which reads this file and emits
 *  reports/cluster-graph-<town_id>.json for review before Phase 2
 *  (breadcrumbs) starts.
 *
 *  Route keys mostly reuse config/page-meta.ts's own vocabulary
 *  (`city-hall`, `events`, `facilities/detail`, ...) where a route is
 *  already registered there -- one shared naming convention across both
 *  catalogs, not two that could drift. A handful of route keys exist here
 *  that page-meta.ts has no reason to know about (dynamic listing/detail
 *  pages with no distinct title pattern of their own, e.g.
 *  `events/facet`), and a few registered `story:<sourceType>` keys that
 *  don't correspond to a single template at all -- see ROUTE_AVAILABILITY's
 *  own comment below for what those mean.
 */
import type { SiteConfig } from '../lib/site-config';

export interface ClusterDefinition {
  key: string;
  /** Human-facing, appears in breadcrumbs and hub link cards (Phase 2/3). */
  label: string;
  /** Route key for this cluster's hub page. See CLUSTER_TOWN_OVERRIDES below
   *  for the one case (local_life) where this differs per town. */
  hubRoute: string;
  primarySpokes: string[];
  secondarySpokes: string[];
}

/** The six clusters, derived from what a resident actually needs from a
 *  town site -- not from keyword volume. See the handoff's own "Current
 *  state" section for the existing assets each hub already partially
 *  covers (getRelatedContent, city-hall/projects, city-hall/archive).
 *
 *  Gating is NOT encoded here as a per-town spoke list -- see the
 *  handoff's own explicit instruction ("derive gating from existing
 *  feature config, not a hand-maintained list") and ROUTE_AVAILABILITY
 *  below, which is what actually decides whether a given spoke survives
 *  for a given town. This file lists every spoke a cluster could ever
 *  have; resolveCluster() filters it per town at resolve time.
 */
export const CLUSTERS: Record<string, ClusterDefinition> = {
  civic: {
    key: 'civic',
    label: 'City Hall',
    hubRoute: 'city-hall',
    primarySpokes: [
      'city-hall/archive', 'city-hall/projects', 'city-hall/projects/detail',
      'story:meeting', 'story:meeting_followup',
    ],
    // home-sales: the handoff's own explicit cross-cluster example --
    // "genuinely relevant from /city-hall/ when a development decision is
    // in play." Primary home is work_and_money; this is its one allowed
    // secondary membership.
    secondarySpokes: ['home-sales'],
  },
  whats_happening: {
    key: 'whats_happening',
    label: "What's happening",
    hubRoute: 'events',
    primarySpokes: [
      'today', 'this-week', 'whats-on', 'whats-on/detail',
      'free-things-to-do', 'story:event', 'events/facet', 'events/past',
    ],
    secondarySpokes: ['story:weekly'],
  },
  getting_around: {
    key: 'getting_around',
    label: 'Getting around',
    hubRoute: 'traffic',
    primarySpokes: ['closures', 'story:alert'],
    secondarySpokes: [],
  },
  work_and_money: {
    key: 'work_and_money',
    label: 'Work and money',
    hubRoute: 'workplace-watch',
    primarySpokes: [
      'jobs', 'jobs/category', 'story:workplace_watch_digest',
      'home-sales', 'home-sales/detail', 'home-sales/archive', 'home-sales/zip',
    ],
    secondarySpokes: ['story:home_sales_digest'],
  },
  places: {
    key: 'places',
    label: 'Places',
    hubRoute: 'facilities',
    primarySpokes: ['facilities/detail', 'weather'],
    // free-things-to-do: the handoff's own other half of the cross-cluster
    // example above. Primary home is whats_happening.
    secondarySpokes: ['free-things-to-do'],
  },
  // hubRoute here is a placeholder only -- see CLUSTER_TOWN_OVERRIDES.
  // Every real town has its own distinct flagship "local life" page
  // (jackrabbits.astro / sports.astro / vail-resorts.astro -- three
  // separate files, not one shared route with per-town content, the SAME
  // real architecture shape the metadata handoff already found and
  // corrected for sports/jackrabbits specifically -- see
  // NEEDS-HUMAN-REVIEW.md #49). The handoff's own literal text names
  // `/sports/` as the shared hub for this cluster; that's the one place
  // this config deliberately does NOT follow the handoff literally, for
  // the same reason page-meta.ts's sports/jackrabbits correction didn't:
  // /sports/ redirects away for both Brookings and Broomfield, so it
  // cannot be their hub. The shared spoke list below (recipes/editorials/
  // columns/reviews, plus every town-specific page) is real per the
  // handoff's own "town-specific" framing -- ROUTE_AVAILABILITY decides
  // which ones survive per town, not a hand-written per-town spoke list.
  local_life: {
    key: 'local_life',
    label: 'Local life',
    hubRoute: 'sports', // overridden per town below -- never resolved as-is
    primarySpokes: [
      'university', 'play', 'farm-report', 'burro-bonanza',
      'recipes', 'editorials', 'columns', 'reviews',
    ],
    secondarySpokes: [],
  },
};

/** The one genuinely per-town override this config needs: local_life's
 *  hub route differs by town identity, not by a feature flag (each town
 *  has exactly one, unconditionally -- there's no "off" state to derive
 *  from config the way workplace-watch or closures have). Narrow on
 *  purpose, same "shared defaults, override only the real difference"
 *  shape as page-meta.ts's own (now-empty) TOWN_OVERRIDES. */
export const CLUSTER_TOWN_OVERRIDES: Record<string, Partial<Record<string, Pick<ClusterDefinition, 'hubRoute'>>>> = {
  brookings_sd: { local_life: { hubRoute: 'jackrabbits' } },
  moreno_valley_ca: { local_life: { hubRoute: 'sports' } },
  broomfield_co: { local_life: { hubRoute: 'vail-resorts' } },
};

export type RouteAvailability = (config: SiteConfig) => boolean;

/** Every route key any cluster (hub or spoke) references, mapped to a
 *  predicate deciding whether it's real for a given town. Each predicate
 *  reads an EXISTING flag or town-identity check already used by that
 *  page's own real gate in src/pages -- never a parallel hand-maintained
 *  "which towns have X" list. Where the source page has no gate at all
 *  (renders unconditionally, empty is a valid, handled state -- e.g.
 *  /events/ for a town with no local events source), the predicate is
 *  `() => true`: an empty page is not the same as a disabled one, and
 *  this codebase already treats "gracefully empty" as the norm (see
 *  EMPTY_STATES, home-sales.astro, jobs.astro).
 *
 *  A small number of keys aren't a single page template at all:
 *  `story:<sourceType>` represents the GROUP of `/s/[slug]/` permalinks of
 *  that source_type (see lib/db.ts's own SourceType union) -- there is one
 *  shared dynamic template (`pages/s/[slug].astro`) behind every story
 *  type, so per-type "does this exist" is a real-data question
 *  (checked live via a cheap existence probe in the graph script), not a
 *  route-file question. The "detail" keys (e.g. `facilities/detail`) are
 *  similarly one dynamic route file generating many real pages
 *  (facilities/[slug], home-sales/[slug],
 *  city-hall/projects/[slug], whats-on/[slug]) -- gated the same way their
 *  parent section is, since none of them has an independent gate of its
 *  own.
 */
export const ROUTE_AVAILABILITY: Record<string, RouteAvailability> = {
  // Civic -- city-hall.astro has no gate; every town has meetings.
  'city-hall': () => true,
  'city-hall/archive': () => true,
  'city-hall/projects': () => true,
  'city-hall/projects/detail': () => true,
  'story:meeting': () => true,
  'story:meeting_followup': () => true,

  // What's happening -- events.astro/today.astro/this-week/[week].astro
  // have no gate either; a town with no local events source (Broomfield)
  // still renders these pages, just emptier of locally-sourced items.
  events: () => true,
  today: () => true,
  'this-week': () => true,
  'events/facet': () => true,
  'events/past': () => true,
  'story:event': () => true,
  'story:weekly': () => true,
  // whats-on IS a real gate (whats-on/index.astro redirects on
  // !hasWhatsOn) -- true for all three towns today, but this must keep
  // reading the flag, not assume that permanently.
  'whats-on': (c) => Boolean(c.hasWhatsOn),
  'whats-on/detail': (c) => Boolean(c.hasWhatsOn),
  // Confirmed nowhere in the codebase (see page-meta.ts's own identical
  // finding) -- always false, so this key vanishes from every town's
  // resolved graph. Kept registered, not deleted, for the same reason
  // page-meta.ts kept its own inert entry.
  'free-things-to-do': () => false,

  // Getting around -- traffic.astro has no gate (a town with no known
  // live incident source, Brookings, still renders an honest "no source
  // found yet" state, per siteConfig.trafficSource's own doc comment).
  traffic: () => true,
  // closures.astro DOES redirect on !hasClosureWatch -- false for
  // Broomfield today (no closureWatch block configured for it).
  closures: (c) => Boolean(c.hasClosureWatch),
  'story:alert': () => true,

  // Work and money -- workplace-watch/index.astro redirects on
  // !hasWorkplaceWatch -- false for Brookings today (no Worker Pulse
  // source there).
  'workplace-watch': (c) => Boolean(c.hasWorkplaceWatch),
  'story:workplace_watch_digest': (c) => Boolean(c.hasWorkplaceWatch),
  // jobs.astro has no gate at all (Adzuna's own coverage decides what
  // shows, not a per-town flag -- see that page's own comment) -- even a
  // town whose workplace-watch hub is dark still gets a real /jobs/ page,
  // which the graph script's orphan check should surface plainly rather
  // than silently accepting as "part of a disabled cluster."
  jobs: () => true,
  'jobs/category': () => true,
  // home-sales.astro hard-gates on townId === 'moreno_valley_ca';
  // hasHousingMarket mirrors that exactly (only Moreno Valley sets it) --
  // reading the flag here rather than re-deriving the townId check a
  // second time.
  'home-sales': (c) => Boolean(c.hasHousingMarket),
  'home-sales/detail': (c) => Boolean(c.hasHousingMarket),
  'home-sales/archive': (c) => Boolean(c.hasHousingMarket),
  'home-sales/zip': (c) => Boolean(c.hasHousingMarket),
  'story:home_sales_digest': (c) => Boolean(c.hasHousingMarket),

  // Places -- facilities/index.astro and weather.astro have no gate.
  facilities: () => true,
  'facilities/detail': () => true,
  weather: () => true,

  // Local life -- three separate, mutually-exclusive per-town hub pages,
  // each a hard townId gate in its own file. Never a spoke anywhere else
  // (each is exclusively its own town's hub) -- not listed in any
  // cluster's primarySpokes/secondarySpokes above, only reachable via
  // CLUSTER_TOWN_OVERRIDES.
  jackrabbits: (c) => c.townId === 'brookings_sd',
  sports: (c) => c.townId === 'moreno_valley_ca',
  'vail-resorts': (c) => c.townId === 'broomfield_co',
  // Brookings-only spokes (each its own hard townId gate).
  university: (c) => c.townId === 'brookings_sd',
  play: (c) => c.townId === 'brookings_sd',
  'farm-report': (c) => c.townId === 'brookings_sd',
  // Moreno-Valley-only spoke.
  'burro-bonanza': (c) => c.townId === 'moreno_valley_ca',
  // Shared cross-town content-track pages -- no gate on any of them.
  recipes: () => true,
  editorials: () => true,
  columns: () => true,
  // reviews.astro redirects (301) to /columns/ for Moreno Valley
  // specifically -- an editorial merge, not a missing feature, but the
  // route itself genuinely doesn't exist independently there.
  reviews: (c) => c.townId !== 'moreno_valley_ca',
};
