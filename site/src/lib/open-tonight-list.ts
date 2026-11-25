/** The Open tonight list (owner 2026-11-25, shared by /today and /tonight in every town, components/OpenTonightList.astro): places grouped by
 *  closing time with the time in the group heading ("Until 03:00", "Until midnight"), never "Open until" on a row. Each row is two fixed
 *  lines (name; kind · area) and links to the place's website, else its OpenStreetMap page. Filter chips by kind, at most
 *  OPEN_TONIGHT_GROUP_MAX rows per group before "Show all (N)", closed places gone and "closes soon" under an hour: decided in the
 *  browser (lib/client/open-tonight-list.ts), because a static page cannot know the time. */
import type { OpenLateKind, OpenLateRow } from './osm-open-late';
import { planChips } from './ui/ui-helpers';

export const OPEN_TONIGHT_GROUP_MAX = 8;
/** "closes soon" when less than this is left before closing. */
export const CLOSES_SOON_MS = 3_600_000;

/** Chip label per kind, in the owner's order (All · Bars · Pubs · Restaurants; Nightclubs after them when the data has them). */
export const KIND_CHIP: Record<Exclude<OpenLateKind, 'Cafe'>, string> = { Bar: 'Bars', Pub: 'Pubs', Restaurant: 'Restaurants', Nightclub: 'Nightclubs' };
const CHIP_ORDER = ['Bars', 'Pubs', 'Restaurants', 'Nightclubs'];

export interface OpenTonightGroup { key: string; label: string; rows: OpenLateRow[] }

/** The group heading for a row's closing label: "Open until 01:00" -> "Until 01:00", "Open until 00:00" -> "Until midnight",
 *  "Open 24 hours" stays. Rows without a trusted closing time (closing '') go under "Open late". */
export function groupLabelOf(closing: string): string {
  const m = /^Open until (\d{2}:\d{2})$/.exec(closing);
  if (m) return m[1] === '00:00' ? 'Until midnight' : `Until ${m[1]}`;
  return closing === 'Open 24 hours' ? closing : 'Open late';
}

/** Rows (already latest-closing first, lib/open-tonight.ts) into groups in that order. */
export function groupByClosing(rows: OpenLateRow[]): OpenTonightGroup[] {
  const groups: OpenTonightGroup[] = [];
  for (const r of rows) {
    const label = groupLabelOf(r.closing);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label, rows: [] }));
    g.rows.push(r);
  }
  return groups;
}

/** Where a row goes: the place's own website, else its OpenStreetMap page (every row has an OSM id). */
export function rowHref(r: Pick<OpenLateRow, 'website' | 'osmId'>): string {
  return r.website ?? `https://www.openstreetmap.org/${r.osmId}`;
}

/** Line 2 of a row: "Pub · Merchant City". */
export const rowMeta = (r: Pick<OpenLateRow, 'kind' | 'area'>): string => [r.kind, r.area].filter(Boolean).join(' · ');

/** The chips over the list: only kinds in the data, by the design system's rule (planChips: >= 3 places per chip, >= 2 chips), in the
 *  owner's order. [] = no chip row. */
export function kindChips(rows: Pick<OpenLateRow, 'kind'>[]): string[] {
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.kind !== 'Cafe') counts[KIND_CHIP[r.kind]] = (counts[KIND_CHIP[r.kind]] ?? 0) + 1;
  const planned = new Set(planChips(counts));
  return CHIP_ORDER.filter((c) => planned.has(c));
}
