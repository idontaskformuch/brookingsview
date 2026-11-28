/** /help/ postcode and distance helpers, with no imports: the browser script (lib/client/help-page.ts) and the build (lib/help-view.ts)
 *  share them. */
const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/i;
/** "G51 1QH" -> "G51" (the outcode); a ZIP stays the ZIP; nothing -> null. */
export function postalDistrict(postcode: string | null): string | null {
  if (!postcode) return null;
  const m = UK_POSTCODE.exec(postcode.trim());
  return m ? m[1].toUpperCase() : postcode.trim();
}

const RAD = Math.PI / 180;
/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
/** Nearest first; a point without coordinates goes last, in its old order. Used by the browser after a postcodes.io lookup. */
export function sortByDistance<T extends { lat: number | null; lon: number | null }>(items: T[], from: { lat: number; lon: number }): T[] {
  const d = (i: T) => (i.lat == null || i.lon == null ? Infinity : distanceKm(from, { lat: i.lat, lon: i.lon }));
  return items.map((it, i) => ({ it, i, d: d(it) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.it);
}
/** Fallback when the lookup fails: the order (indices) with the visitor's own outcode first, then the same postcode area letters. */
export function outcodeOrder(districts: (string | null)[], postcode: string): number[] {
  const out = postalDistrict(postcode.toUpperCase()) ?? '';
  const letters = (s: string) => /^[A-Z]+/i.exec(s)?.[0].toUpperCase() ?? '';
  const rank = (d: string | null) => (!d ? 2 : d.toUpperCase() === out ? 0 : letters(d) === letters(out) ? 1 : 2);
  return districts.map((d, i) => ({ i, r: rank(d) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.i);
}
