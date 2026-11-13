/** Whether a section's page is built in a town: the one rule the section pages gate on (a town where it is not built gets a
 *  redirect stub) and every link to the section asks first -- menu (lib/nav-sections.ts), cluster links (config/clusters.ts),
 *  footer, related cards, quick links (F18, owner 2026-11-13: Glasgow's footer linked /advertising/ and /jobs/, Broomfield's
 *  /vail-resorts/ linked /reviews/ and its weeks /sports/, all redirect stubs).
 *
 *  Built = the section's own town gate passes AND the town has not switched it off in SiteConfig.disabledSections. Types
 *  only from site-config.ts, so the nav and cluster registries can import this without a cycle. */
import type { SiteConfig } from './site-config';

export type SectionGate = Pick<SiteConfig, 'townId' | 'disabledSections' | 'trafficSource'>;

/** Each section's own town gate, before disabledSections. */
const GATES = {
  advertising: () => true,
  jobs: () => true,
  weather: () => true,
  facilities: () => true,
  // [traffic].astro builds no path without a source (owner 2026-11-07).
  traffic: (c: SectionGate) => !!c.trafficSource,
  // reviews.astro 301s to /columns/ for Moreno Valley (media_recension folded in there).
  reviews: (c: SectionGate) => c.townId !== 'moreno_valley_ca',
  recipes: () => true,
  editorials: () => true,
  columns: () => true,
  // Each town's own local-life hub, a hard townId gate in its page.
  jackrabbits: (c: SectionGate) => c.townId === 'brookings_sd',
  sports: (c: SectionGate) => c.townId === 'moreno_valley_ca',
  'vail-resorts': (c: SectionGate) => c.townId === 'broomfield_co',
} satisfies Record<string, (c: SectionGate) => boolean>;

export type SectionId = keyof typeof GATES;

export function isSectionBuilt(id: SectionId, c: SectionGate): boolean {
  return GATES[id](c) && !c.disabledSections?.includes(id);
}

const SECTION_BY_PATH = new Map(Object.keys(GATES).map((id) => [`/${id}/`, id as SectionId]));

/** False for a link to a section page the town does not build; true for every other link. For lists of links assembled
 *  from many branches (related cards), so a new branch cannot bring a dead section link back. */
export function linksToBuiltSection(href: string, c: SectionGate): boolean {
  const id = SECTION_BY_PATH.get(href);
  return id === undefined || isSectionBuilt(id, c);
}

/** The town's sports page (Jackrabbits in Brookings, Sports in Moreno Valley), or null where neither is built. */
export function sportsHref(c: SectionGate): string | null {
  return isSectionBuilt('jackrabbits', c) ? '/jackrabbits/' : isSectionBuilt('sports', c) ? '/sports/' : null;
}
