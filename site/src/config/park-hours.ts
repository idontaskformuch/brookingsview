/** Each town's own rule for when its city parks are open (owner order D 2, 2026-11-25). A park with its own hours (place_hours
 *  rows or hours_structured) keeps them; a city park without gets this rule, shown as "City park hours" with the rule as source.
 *  A row in `exceptSlugs` is in the park category but not run by the city, or has a schedule of its own the rule does not
 *  speak for, so it gets no hours until its own source is read. Wording and URLs: .claude/audit/sources-<town>.md (read
 *  2026-11-25 through PoliteFetcher). */
export interface ParkHoursRule {
  opens: string;
  closes: string;
  sourceUrl: string;
  /** The rule as the source states it. */
  quote: string;
  exceptSlugs: string[];
}

export const PARK_HOURS_LABEL = 'City park hours';

export const PARK_HOURS: Record<string, ParkHoursRule> = {
  brookings_sd: {
    opens: '06:00',
    closes: '23:00',
    sourceUrl: 'https://www.cityofbrookings-sd.gov/DocumentCenter/View/3870/Rules-and-Regulations-for-City-Parks-System',
    quote: 'City of Brookings Park Hours is 6:00 am to 11:00 pm, unless otherwise posted.',
    // SDSU's garden, not a city park; its page links to the garden's own hours (lib/hours-link-only.ts).
    exceptSlugs: ['mccrory-gardens'],
  },
  moreno_valley_ca: {
    opens: '07:00',
    closes: '22:00',
    sourceUrl: 'https://www.moval.gov/parks-comm-svc/parks-parks.html',
    quote: 'All City parks are open Monday - Sunday 7 am - 10 pm.',
    // A golf center, the equestrian park and nature center, and the amphitheater keep schedules of their own
    // (sources-moreno-valley.md, decision 1).
    exceptSlugs: ['cottonwood-golf-center-banquet-facility', 'moreno-valley-equestrian-park-nature-center', 'civic-center-amphitheater-park'],
  },
  broomfield_co: {
    opens: '05:00',
    closes: '23:00',
    sourceUrl: 'https://www.broomfield.org/593/Parks-and-Park-Shelters',
    quote: 'City and County of Broomfield park use hours are 5 a.m. - 11 p.m. (B.M.C. 12-28-040)',
    // The skate park has its own hours (6 a.m. to 10 p.m., place_hours), which win anyway.
    exceptSlugs: [],
  },
};
