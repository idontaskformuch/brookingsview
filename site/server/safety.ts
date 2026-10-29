/** GET /api/safety -- wildfires near the town and the current air-quality reading, for the town the request's hostname belongs to
 *  (public_safety_notices, written every 15 minutes by the cron-dispatcher Worker, src/safety/). Read-only, official fields only (the
 *  source's own name, size, containment, AQI and category), nothing reworded and no advice of our own. Spec .claude/specs/public-safety.md.
 *
 *  Fail closed: a row the poll has not confirmed for 60 minutes is not shown, an air reading older than 3 hours is not shown, and any
 *  database error (e.g. the table is not there yet) gives `available: false` and nothing else. Evacuation: we never state evacuation
 *  facts ourselves, we only link the official map/notice pages (links only, broomfield.org is never fetched). */
import { neon } from '@neondatabase/serverless';
import { hasCrimeWord } from '../src/lib/safety-filter';
import { townFromHostname, type Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' };
export const FIRE_CONFIRMED_WITHIN_MS = 60 * 60_000;
export const AIR_MAX_AGE_MS = 3 * 60 * 60_000;

export interface SafetyLink { label: string; url: string }
export interface SafetyTownInfo { evacuation: SafetyLink[]; evacuationNote: string }

/** Evacuation pages per town (owner 2026-10-29). Towns not listed get no safety block and no database read. */
export const SAFETY_TOWNS: Record<string, SafetyTownInfo> = {
  moreno_valley_ca: {
    evacuation: [{ label: 'Riverside County evacuation map (Genasys Protect)', url: 'https://protect.genasys.com/search?z=12&latlon=33.9425,-117.2297' }],
    evacuationNote: 'Evacuation maps can lag behind a fast-moving fire. If you are told to leave, leave.',
  },
  broomfield_co: {
    evacuation: [
      { label: 'City and County of Broomfield: emergency status', url: 'https://www.broomfield.org/EmergencyStatus' },
      { label: 'LookoutAlert, Broomfield’s warning system', url: 'https://www.broomfield.org/LookoutAlert' },
    ],
    evacuationNote: 'Maps and notices can lag behind a fast-moving fire. If you are told to leave, leave.',
  },
};

export interface NoticeRow {
  kind: 'fire' | 'air';
  title: string;
  url: string | null;
  raw_data: Record<string, unknown> | null;
  observed_at: string | Date | null;
  last_seen: string | Date;
}

export interface PublicFire { id: string; name: string; acres: number | null; percentContained: number | null; county: string | null; distanceMiles: number | null; updated: string | null; sourceName: string; sourceUrl: string }
/** EPA's AQI colours by category number 1-6 (Good ... Hazardous). */
export const AQI_COLORS = ['#00E400', '#FFFF00', '#FF7E00', '#FF0000', '#8F3F97', '#7E0023'];
export interface PublicAir { aqi: number; category: string; categoryNumber: number; color: string; parameter: string; reportingArea: string; station: string; observed: string; observedLocal: string; preliminary: true; sourceName: string; sourceUrl: string }

const iso = (v: string | Date | null): string | null => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function toPublicSafety(rows: NoticeRow[], now: Date): { fires: PublicFire[]; air: PublicAir | null; held: number } {
  const fires: PublicFire[] = [];
  let air: PublicAir | null = null;
  let held = 0;
  for (const r of rows) {
    const d = r.raw_data ?? {};
    const seen = new Date(r.last_seen).getTime();
    if (Number.isNaN(seen) || now.getTime() - seen > FIRE_CONFIRMED_WITHIN_MS) continue;
    if (r.kind === 'fire') {
      if (hasCrimeWord(r.title) || hasCrimeWord(strOrNull(d.county))) { held++; continue; }
      fires.push({
        id: `${r.title}|${r.observed_at}`, name: r.title, acres: numOrNull(d.acres), percentContained: numOrNull(d.percentContained), county: strOrNull(d.county),
        distanceMiles: numOrNull(d.distanceMiles), updated: iso(r.observed_at), sourceName: 'NIFC', sourceUrl: r.url ?? 'https://data-nifc.opendata.arcgis.com/',
      });
    } else if (r.kind === 'air') {
      const observed = iso(r.observed_at);
      const aqi = numOrNull(d.aqi);
      if (!observed || aqi === null || !strOrNull(d.category) || now.getTime() - new Date(observed).getTime() > AIR_MAX_AGE_MS) continue;
      const cat = Math.min(6, Math.max(1, numOrNull(d.categoryNumber) ?? 1));
      air = {
        aqi, category: String(d.category), categoryNumber: cat, color: AQI_COLORS[cat - 1], parameter: String(d.parameter ?? ''), reportingArea: String(d.reportingArea ?? ''), station: String(d.station ?? ''), observed, observedLocal: String(d.observedLocal ?? ''),
        preliminary: true, sourceName: 'AirNow (EPA)', sourceUrl: r.url ?? 'https://www.airnow.gov/',
      };
    }
  }
  fires.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));
  return { fires, air, held };
}

export interface SafetyDeps {
  now?: () => Date;
  loadRows?: (databaseUrl: string, townId: string) => Promise<NoticeRow[]>;
}

export async function handleSafety(request: Request, env: Env, deps: SafetyDeps = {}): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (!townId) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: HEADERS });
  const info = SAFETY_TOWNS[townId];
  if (!info) return new Response(JSON.stringify({ town: townId, available: false, fires: [], air: null }), { headers: HEADERS });
  const now = (deps.now ?? (() => new Date()))();
  const load = deps.loadRows ?? (async (url: string, t: string) => {
    const sql = neon(url);
    return (await sql`
      SELECT kind, title, url, raw_data, observed_at, last_seen FROM public_safety_notices
       WHERE town_id = ${t} AND ended_at IS NULL AND last_seen > now() - interval '24 hours'`) as unknown as NoticeRow[];
  });
  try {
    const { fires, air, held } = toPublicSafety(await load(env.DATABASE_URL, townId), now);
    return new Response(JSON.stringify({ town: townId, available: true, checkedAt: now.toISOString(), fires, air, held, evacuation: { links: info.evacuation, note: info.evacuationNote } }), { headers: HEADERS });
  } catch (e) {
    console.error('safety: read failed', String((e as Error)?.message ?? e).slice(0, 200));
    return new Response(JSON.stringify({ town: townId, available: false, fires: [], air: null, evacuation: { links: info.evacuation, note: info.evacuationNote } }), { headers: { ...HEADERS, 'Cache-Control': 'public, max-age=30' } });
  }
}
