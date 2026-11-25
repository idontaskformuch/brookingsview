/** Sunrise for a calendar date and a place, deterministic (owner order D 3, 2026-11-25: "Sunrise to 11 p.m." park hours,
 *  computed per day from the town's coordinates, no model, no external service). The sunrise equation as NOAA states it
 *  (mean anomaly, equation of center, ecliptic longitude, declination, hour angle at -0.833 degrees for refraction and the
 *  sun's radius); accurate to about a minute at these latitudes, which is finer than any posted park hour. Client-safe. */

const RAD = Math.PI / 180;

/** Sunrise as a Date (an instant), or null on a day the sun does not rise or set (polar latitudes). */
export function sunriseInstant(isoDate: string, lat: number, lon: number): Date | null {
  const [y, m, d] = isoDate.split('-').map(Number);
  const julianDay = Date.UTC(y, m - 1, d) / 86_400_000 + 2440587.5;
  const n = Math.round(julianDay - 2451545.0 + 0.0008);
  const meanSolarNoon = n - lon / 360;
  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const center = 1.9148 * Math.sin(meanAnomaly * RAD) + 0.02 * Math.sin(2 * meanAnomaly * RAD) + 0.0003 * Math.sin(3 * meanAnomaly * RAD);
  const eclipticLongitude = (meanAnomaly + center + 180 + 102.9372) % 360;
  const transit = 2451545.0 + meanSolarNoon + 0.0053 * Math.sin(meanAnomaly * RAD) - 0.0069 * Math.sin(2 * eclipticLongitude * RAD);
  const declination = Math.asin(Math.sin(eclipticLongitude * RAD) * Math.sin(23.4397 * RAD));
  const cosHourAngle = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(declination)) / (Math.cos(lat * RAD) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const rise = transit - hourAngle / 360;
  return new Date((rise - 2440587.5) * 86_400_000);
}

/** Sunrise on `isoDate` as local "HH:MM" in `timezone`, rounded to the minute; null when the sun does not rise. */
export function sunriseHHMM(isoDate: string, lat: number, lon: number, timezone: string): string | null {
  const instant = sunriseInstant(isoDate, lat, lon);
  if (!instant) return null;
  const rounded = new Date(Math.round(instant.getTime() / 60_000) * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(rounded);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('hour')}:${get('minute')}`;
}
