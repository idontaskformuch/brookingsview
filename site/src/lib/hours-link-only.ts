/** Places whose hours we do not state in our own words: the page shows a link to the place's own hours page instead, with no
 *  open/closed pill (owner order 2026-11-25, punkt 3). Both sources disallow AI crawlers (llm_excluded), so their text is not
 *  read or rephrased here; the link goes to the row's own source_url, else its website.
 *  Rows: brookings_sd places 107 (mccrory-gardens) and 238 (childrens-museum-of-south-dakota). */
export const HOURS_LINK_ONLY: Record<string, Record<string, string>> = {
  brookings_sd: {
    'mccrory-gardens': "Hours on McCrory Gardens' website",
    'childrens-museum-of-south-dakota': "Hours on the Children's Museum's website",
  },
};

/** The slugs in this town whose own hours the site must not show (lib/db.ts also leaves out their place_hours rows). */
export function hoursLinkOnlySlugs(townId: string): string[] {
  return Object.keys(HOURS_LINK_ONLY[townId] ?? {});
}

export interface HoursLink {
  label: string;
  url: string;
}

interface HoursFields {
  slug: string;
  hours_text: string | null;
  hours_structured: unknown;
  source_url: string | null;
  website: string | null;
}

/** Drops the row's own hours (text and structure) and sets `hours_link` for a place in HOURS_LINK_ONLY; other rows unchanged. */
export function applyHoursLinkOnly<T extends HoursFields>(townId: string, row: T): T & { hours_link: HoursLink | null } {
  const label = HOURS_LINK_ONLY[townId]?.[row.slug];
  const url = row.source_url || row.website;
  if (!label || !url) return { ...row, hours_link: null };
  return { ...row, hours_text: null, hours_structured: null, hours_link: { label, url } };
}
