/** What the browser shows from GET /api/safety (server/safety.ts): plain strings built from the source's own fields, nothing reworded and no
 *  advice of our own. Pure functions so they are tested; components/SafetyNotices.astro sets the text with textContent. */
export interface PublicFire { id: string; name: string; acres: number | null; percentContained: number | null; county: string | null; distanceMiles: number | null; updated: string | null; sourceName: string; sourceUrl: string }
export interface PublicAir { aqi: number; category: string; categoryNumber: number; color: string; parameter: string; reportingArea: string; station: string; observed: string; observedLocal: string; preliminary: true; sourceName: string; sourceUrl: string }
export interface SafetyPayload {
  town: string;
  available: boolean;
  checkedAt?: string;
  fires: PublicFire[];
  air: PublicAir | null;
  evacuation?: { links: Array<{ label: string; url: string }>; note: string };
}

/** The browser drops a payload this old (the endpoint is cached for a minute; a tab left open for hours must not keep showing a fire). */
export const PAYLOAD_MAX_AGE_MS = 15 * 60_000;
/** An air reading older than this is not shown (same as the Worker). */
export const AIR_MAX_AGE_MS = 3 * 60 * 60_000;

export function isFresh(p: SafetyPayload | null, nowMs: number): p is SafetyPayload {
  if (!p || !p.available || !p.checkedAt) return false;
  const t = new Date(p.checkedAt).getTime();
  return !Number.isNaN(t) && nowMs - t <= PAYLOAD_MAX_AGE_MS;
}

const fmtTime = (iso: string | null, tz: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
};

const acres = (n: number): string => `${Math.round(n).toLocaleString('en-US')} acre${Math.round(n) === 1 ? '' : 's'}`;

/** "SAGE · 120 acres · 15% contained · Riverside County · 9.4 miles away · source updated Oct 29, 10:00 AM" */
export function fireLine(f: PublicFire, tz: string): string {
  const parts: string[] = [f.name];
  if (f.acres !== null) parts.push(acres(f.acres));
  parts.push(f.percentContained !== null ? `${Math.round(f.percentContained)}% contained` : 'containment not reported');
  if (f.county) parts.push(`${f.county} County`);
  if (f.distanceMiles !== null) parts.push(`${f.distanceMiles} miles away`);
  const when = fmtTime(f.updated, tz);
  if (when) parts.push(`source updated ${when}`);
  return parts.join(' · ');
}

/** "Air quality index 54 (Moderate), PM2.5, Perris Vly. Preliminary data, observed 2026-10-29 08:00 PDT." */
export function airLine(a: PublicAir, nowMs: number): string | null {
  if (nowMs - new Date(a.observed).getTime() > AIR_MAX_AGE_MS) return null;
  const where = a.reportingArea ? `, ${a.reportingArea}` : '';
  const what = a.parameter ? `, ${a.parameter}` : '';
  return `Air quality index ${a.aqi} (${a.category})${what}${where}. Preliminary data, observed ${a.observedLocal}.`;
}

/** One short line for /today: counts, nearest fire, and the air reading. Null = nothing to show (service unavailable or stale). */
export function compactLine(p: SafetyPayload | null, nowMs: number, radiusMiles: number): string | null {
  if (!isFresh(p, nowMs)) return null;
  const parts: string[] = [];
  if (p.fires.length === 0) parts.push(`No wildfires listed within ${radiusMiles} miles`);
  else {
    const n = p.fires[0];
    const near = `${n.name}${n.distanceMiles !== null ? `, ${n.distanceMiles} miles away` : ''}${n.percentContained !== null ? `, ${Math.round(n.percentContained)}% contained` : ''}`;
    parts.push(`${p.fires.length} wildfire${p.fires.length === 1 ? '' : 's'} within ${radiusMiles} miles (nearest: ${near})`);
  }
  const air = p.air && nowMs - new Date(p.air.observed).getTime() <= AIR_MAX_AGE_MS ? p.air : null;
  if (air) parts.push(`air quality index ${air.aqi} (${air.category}, preliminary)`);
  return parts.join(' · ');
}
