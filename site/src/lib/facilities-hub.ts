/** Pure rules for the /facilities/ hub (designsystem Fas 4, Facilities, 2026-11-25). DB-free; the page passes the rows in.
 *  - The heading may only promise hours when most listed places have them (hubPromisesHours).
 *  - The town, state and shared ZIP are said once by the page, not on every row (shortAddress).
 *  - Weekly hours come from the same effective hours the open/closed pill reads (lib/hours-spec.ts effectiveHours: place_hours
 *    rows, else hours_structured with its season in force; weeklyHoursLine).
 *  - Park amenities only from the place's own services list, via config/park-amenities.ts (parkAmenities). */
import { PARK_AMENITIES, type ParkAmenity } from '../config/park-amenities';
import type { PlaceHoursRow } from './db';
import { summarizeHours } from './facility-lede';

/** True when at least half of the places have hours (effective hours: place_hours rows or hours_structured; before order D
 *  only hours_structured counted, so Broomfield's court, police and Workforce Center rows were invisible here). Below that the
 *  hub's heading names the kinds of places instead of promising hours (spec: "Rubriken får inte lova sådant som inte finns"). */
export function hubPromisesHours(places: { hasHours: boolean; slug?: string }[], eventVenues: string[] = []): boolean {
  // Event venues (config/hours-scope.ts) have no opening hours to have: not counted either way (order D 6).
  const counted = places.filter((p) => !(p.slug && eventVenues.includes(p.slug)));
  if (counted.length === 0) return false;
  const withHours = counted.filter((p) => p.hasHours).length;
  return withHours * 2 >= counted.length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The address without ", <Town>[, ST][ 12345]". A UK postcode after the town stays (it tells places apart):
 *  "Kings Drive, Glasgow G40 1HB" -> "Kings Drive, G40 1HB". A note in brackets after it stays too. An address that is only the
 *  town (or names another town) is returned as null / unchanged. */
export function shortAddress(address: string | null, cityName: string): string | null {
  if (!address) return null;
  const town = escapeRegExp(cityName);
  const usTail = new RegExp(`(^|,\\s*)${town}(,\\s*[A-Z]{2})?(\\s+\\d{5}(-\\d{4})?)?(?=\\s*(\\(|$))`);
  const m = usTail.exec(address);
  if (m) {
    const out = (address.slice(0, m.index) + address.slice(m.index + m[0].length)).replace(/\s+\(/, ' (').trim();
    return out === '' ? null : out;
  }
  const gbTail = new RegExp(`,\\s*${town}\\s+([A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2})\\s*$`);
  if (gbTail.test(address)) return address.replace(gbTail, ', $1');
  return address;
}

/** "Mon–Thu 9:30am–8pm, Fri–Sat 9:30am–5:30pm" from the week's rows (lib/facility-lede.ts summarizeHours); null without hours. */
export function weeklyHoursLine(rows: PlaceHoursRow[] | null): string | null {
  if (!rows) return null;
  const line = summarizeHours(rows);
  // The same window all seven days is said once: "Daily 6am–11pm", not "Mon–Sun 6am–11pm".
  return line?.startsWith('Mon–Sun ') ? `Daily ${line.slice('Mon–Sun '.length)}` : line;
}

/** The labels from config/park-amenities.ts that this place's services list states, in config order. */
export function parkAmenities(services: string[] | null, amenities: ParkAmenity[] = PARK_AMENITIES): string[] {
  if (!services || services.length === 0) return [];
  const have = new Set(services.map((s) => s.trim().toLowerCase()));
  return amenities.filter((a) => a.sourceValues.some((v) => have.has(v.toLowerCase()))).map((a) => a.label);
}
