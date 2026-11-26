/** Facility types where an entry price is something a visitor asks about, so a facility page's meta may say "Free" (owner order
 *  2026-11-26 (16) 2): museums, parks, libraries, pools and other leisure, galleries and the like. Never on police, court, city hall,
 *  social services, workforce centre, post office, park-n-ride or any other public office or service building, even when the row says
 *  is_free. Keys are places.category (lib/db.ts FACILITY_CATEGORY_LABELS). */
export const ADMISSION_CATEGORIES: ReadonlySet<string> = new Set([
  'museum',
  'park',
  'library',
  // Pools, gyms, recreation centres (Glasgow Club, Paul Derda, The Bay): an entry price applies.
  'leisure',
  'community_center',
  // Drop-off and recycling places (owner 2026-11-26): whether a resident pays to drop off is the question. "Free" only where the row
  // says is_free (Broomfield Recycling Center); a landfill or transfer station that charges has no is_free and never gets it.
  'recycling',
]);

export const admissionRelevant = (category: string | null | undefined): boolean => !!category && ADMISSION_CATEGORIES.has(category);
