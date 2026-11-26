/**
 * Which town a place's own address names (owner 2026-11-26). A place row belongs to a town's site (places.town_id) but may lie in
 * another town: Farm House Collective, 1393 University Ave, Riverside, CA 92507, is listed on the Moreno Valley site. Such a place and
 * its events are shown under "Nearby", never as Moreno Valley: the address is the place's own statement of where it is, so it decides
 * (the boundary test in lib/town-boundary.ts answers a different question -- city limits -- and puts e.g. March Field Park, postal
 * address Moreno Valley, just outside).
 */

// "City, ST", "City, ST 92507" and the event feeds' "City, CA, 92507"
const US_CITY = /(?:^|,)\s*([^,]+?),\s*[A-Z]{2}(?:,?\s+\d{5}(?:-\d{4})?)?\s*$/;
const GB_CITY = /(?:^|,)\s*([^,]+?)\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/;
const COUNTRY_TAIL = /,\s*(United States( of America)?|USA|US|United Kingdom|UK)\s*$/i;

/** The town an address names: "Riverside" from "1393 University Ave, Riverside, CA 92507", "Glasgow" from "Kings Drive, Glasgow G40 1HB".
 *  Null when the address does not end in a town (+ state/postcode). */
export function addressCity(address: string | null | undefined): string | null {
  const a = (address ?? '').trim().replace(COUNTRY_TAIL, '');
  if (!a) return null;
  const m = US_CITY.exec(a) ?? GB_CITY.exec(a);
  return m ? m[1].trim() : null;
}

/** The other town a place lies in, or null when its address names this site's town (or no town at all). */
export function otherTownOf(place: { address?: string | null }, cityName: string): string | null {
  const city = addressCity(place.address);
  return city && city.toLowerCase() !== cityName.trim().toLowerCase() ? city : null;
}
