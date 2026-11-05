/** Sunrise and sunset from latitude/longitude (NOAA's solar calculator; good to about a minute away from the poles). Pure: no network, no
 *  data source. The weather page prints these for each day, with one line in "About this page" saying they are calculated. */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mod = (a: number, m: number) => ((a % m) + m) % m;

export interface SunTimes { sunrise: Date; sunset: Date }

/** Sunrise and sunset (the Sun's upper edge on the horizon, with refraction) for the calendar day y-m-d at the point, as instants.
 *  `null` where the Sun does not rise or does not set that day (polar day / night). The day is the local calendar date at the point, taken
 *  as the UTC date of the same y-m-d: right for every longitude within about 11 hours of Greenwich, which covers all our towns. */
export function sunTimes(y: number, m: number, d: number, lat: number, lon: number): SunTimes | null {
  const jd = Date.UTC(y, m - 1, d, 12) / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const mAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(mAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * mAnom)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * mAnom)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const yy = Math.tan(rad(eps) / 2) ** 2;
  const eqTime = 4 * deg(yy * Math.sin(2 * rad(l0)) - 2 * ecc * Math.sin(rad(mAnom)) + 4 * ecc * yy * Math.sin(rad(mAnom)) * Math.cos(2 * rad(l0))
    - 0.5 * yy * yy * Math.sin(4 * rad(l0)) - 1.25 * ecc * ecc * Math.sin(2 * rad(mAnom)));
  const cosHa = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (!Number.isFinite(cosHa) || cosHa < -1 || cosHa > 1) return null;
  const ha = deg(Math.acos(cosHa));
  const day = Date.UTC(y, m - 1, d);
  const at = (minutes: number) => new Date(day + Math.round(minutes * 60_000));
  return { sunrise: at(720 - 4 * (lon + ha) - eqTime), sunset: at(720 - 4 * (lon - ha) - eqTime) };
}
