/** Section registry + nav config resolver for the shared section navigation
 *  (components/SectionNav.astro). Spec: .claude/spec-section-nav.md.
 *
 *  The registry is the ONE place that says which sections exist, their route,
 *  label and per-town gating (moved here from BaseLayout.astro's old `nav`
 *  array; the footer still reads the same list, so footer links are unchanged).
 *  A town's `nav: { tabs, groups }` (site-config.ts) only orders and groups
 *  section ids; resolveNav() throws -- failing the build -- when that config
 *  disagrees with the registry. */
import type { SiteConfig } from './site-config';

export type NavGate = Pick<SiteConfig, 'townId' | 'hasWhatsOn' | 'hasClosureWatch' | 'hasNewInTown' | 'hasWorkplaceWatch'>;

export interface NavSection {
  id: string;
  /** Route; a function when the route differs per town (Play). */
  href: string | ((c: NavGate) => string);
  label: string;
  /** Footer keeps the label it always had where it differs from the nav label. */
  footerLabel?: string;
  enabled: (c: NavGate) => boolean;
}

const BROOKINGS = (c: NavGate) => c.townId === 'brookings_sd';
const MORENO = (c: NavGate) => c.townId === 'moreno_valley_ca';
const BROOMFIELD = (c: NavGate) => c.townId === 'broomfield_co';

/** Order = the order the old nav array (and so the footer) listed them. */
export const SECTIONS: NavSection[] = [
  { id: 'today', href: '/today/', label: 'Today', enabled: () => true },
  { id: 'thisweek', href: '/this-week/', label: 'This week', enabled: () => true },
  { id: 'events', href: '/events/', label: 'Events', enabled: () => true },
  { id: 'whatson', href: '/whats-on/', label: "What's On", enabled: (c) => !!c.hasWhatsOn },
  { id: 'university', href: '/university/', label: 'University', enabled: BROOKINGS },
  { id: 'jacks', href: '/jackrabbits/', label: 'Jackrabbits', enabled: BROOKINGS },
  { id: 'play', href: (c) => (MORENO(c) ? '/burro-bonanza/' : '/play/'), label: 'Play', enabled: (c) => BROOKINGS(c) || MORENO(c) },
  { id: 'cityhall', href: '/city-hall/', label: 'City Hall', footerLabel: 'City hall', enabled: () => true },
  { id: 'closures', href: '/closures/', label: 'Closure Watch', enabled: (c) => !!c.hasClosureWatch },
  { id: 'newintown', href: '/new-in-town/', label: 'New in Town', enabled: (c) => !!c.hasNewInTown },
  { id: 'facilities', href: '/facilities/', label: 'Facilities', enabled: () => true },
  { id: 'farm', href: '/farm-report/', label: 'Farm Report', footerLabel: 'Farm report', enabled: BROOKINGS },
  { id: 'homesales', href: '/home-sales/', label: 'Home sales', enabled: MORENO },
  { id: 'month', href: '/month/', label: 'Month in review', enabled: MORENO },
  { id: 'sports', href: '/sports/', label: 'Sports', enabled: MORENO },
  { id: 'workplace', href: '/workplace-watch/', label: 'Worker Pulse', enabled: (c) => !!c.hasWorkplaceWatch },
  { id: 'vail', href: '/vail-resorts/', label: 'Vail Resorts', enabled: BROOMFIELD },
  { id: 'traffic', href: '/traffic/', label: 'Traffic', enabled: () => true },
  { id: 'jobs', href: '/jobs/', label: 'Jobs', enabled: () => true },
  { id: 'weather', href: '/weather/', label: 'Weather', enabled: () => true },
];

export interface NavConfig {
  /** The swipe row, priority order, ~7. */
  tabs: string[];
  /** The All sheet: group title -> section ids. Must contain EVERY enabled section. */
  groups: Record<string, string[]>;
}

export interface ResolvedSection { id: string; href: string; label: string }
export interface ResolvedNav {
  tabs: ResolvedSection[];
  groups: { title: string; items: ResolvedSection[] }[];
}

const hrefOf = (s: NavSection, c: NavGate) => (typeof s.href === 'function' ? s.href(c) : s.href);

/** Enabled sections of a town in registry order, as the footer/legacy nav list them. */
export function enabledSections(c: NavGate): ResolvedSection[] {
  return SECTIONS.filter((s) => s.enabled(c)).map((s) => ({ id: s.id, href: hrefOf(s, c), label: s.footerLabel ?? s.label }));
}

/** Validate a town's nav config against the registry and the town's gating; throws on any problem. */
export function resolveNav(cfg: NavConfig, c: NavGate): ResolvedNav {
  const byId = new Map(SECTIONS.map((s) => [s.id, s]));
  const problems: string[] = [];
  const known = (id: string, where: string): NavSection | null => {
    const s = byId.get(id);
    if (!s) { problems.push(`${where}: unknown section id "${id}"`); return null; }
    if (!s.enabled(c)) { problems.push(`${where}: "${id}" is disabled for ${c.townId}`); return null; }
    return s;
  };
  const dup = (ids: string[], where: string) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) problems.push(`${where}: "${id}" is listed twice`); seen.add(id); }
  };

  dup(cfg.tabs, 'tabs');
  const allGrouped = Object.values(cfg.groups).flat();
  dup(allGrouped, 'groups');
  const grouped = new Set(allGrouped);
  for (const id of cfg.tabs) {
    known(id, 'tabs');
    if (!grouped.has(id)) problems.push(`tabs: "${id}" is missing from groups`);
  }
  for (const [title, ids] of Object.entries(cfg.groups)) for (const id of ids) known(id, `groups.${title}`);
  for (const s of SECTIONS) {
    if (s.enabled(c) && !grouped.has(s.id)) problems.push(`groups: enabled section "${s.id}" (${hrefOf(s, c)}) is not in any group`);
  }
  if (problems.length) {
    throw new Error(`Invalid nav config for ${c.townId}:\n  ` + problems.join('\n  '));
  }

  const resolve = (id: string): ResolvedSection => {
    const s = byId.get(id)!;
    return { id, href: hrefOf(s, c), label: s.label };
  };
  return {
    tabs: cfg.tabs.map(resolve),
    groups: Object.entries(cfg.groups)
      .map(([title, ids]) => ({ title, items: ids.map(resolve) }))
      .filter((g) => g.items.length > 0),
  };
}
