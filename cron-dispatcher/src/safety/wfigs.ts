/** Current wildfires near a town from NIFC's WFIGS "Incident Locations Current" layer (public ArcGIS feature service, no key; the layer
 *  caches 300 s and the Worker polls every 15 min, owner cap: no more than every 10 min). Official data only: name, size, containment,
 *  county and the source's own update time. Prescribed burns (RX) and fires marked out are left out. Nothing here is reworded. */
import { distanceMiles, type SafetyTown } from './towns';

export const WFIGS_LAYER = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0';
export const WFIGS_PUBLIC_URL = 'https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-wildland-fire-incident-locations/about';
const USER_AGENT = 'ViewMediaBot/1.0 (+https://brookingsview.com/contact)';
const FIELDS = 'IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,POOState,POOCounty,FireDiscoveryDateTime,ModifiedOnDateTime_dt,FireOutDateTime,IrwinID';

export interface FireNotice {
  externalId: string;
  title: string;
  url: string;
  observedAt: string;
  raw: { acres: number | null; percentContained: number | null; county: string | null; state: string | null; discovered: string | null; distanceMiles: number; source: 'NIFC WFIGS' };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** ArcGIS JSON -> fires inside the radius that are wildfires, not out, and updated by the source within `fireMaxAgeDays` (older = unconfirmed, left out). */
export function parseWfigs(body: unknown, town: SafetyTown, now: Date): FireNotice[] {
  const features = (body as { features?: { attributes?: Record<string, any>; geometry?: { x?: number; y?: number } }[] })?.features;
  if (!Array.isArray(features)) throw new Error('WFIGS: no features array');
  const out: FireNotice[] = [];
  for (const f of features) {
    const a = f.attributes ?? {};
    const id = String(a.IrwinID ?? '').replace(/[{}]/g, '').toLowerCase();
    const name = String(a.IncidentName ?? '').replace(/\s+/g, ' ').trim();
    const modified = num(a.ModifiedOnDateTime_dt);
    if (!id || !name || a.IncidentTypeCategory !== 'WF' || a.FireOutDateTime != null || modified == null) continue;
    if (now.getTime() - modified > town.fireMaxAgeDays * 86_400_000 || modified > now.getTime() + 3_600_000) continue;
    if (typeof f.geometry?.x !== 'number' || typeof f.geometry?.y !== 'number') continue;
    const miles = distanceMiles(town.lat, town.lon, f.geometry.y, f.geometry.x);
    if (miles > town.radiusMiles) continue;
    const discovered = num(a.FireDiscoveryDateTime);
    out.push({
      externalId: id, title: name, url: WFIGS_PUBLIC_URL, observedAt: new Date(modified).toISOString(),
      raw: {
        acres: num(a.IncidentSize), percentContained: num(a.PercentContained), county: a.POOCounty ?? null, state: a.POOState ?? null,
        discovered: discovered == null ? null : new Date(discovered).toISOString(), distanceMiles: Math.round(miles * 10) / 10, source: 'NIFC WFIGS',
      },
    });
  }
  return out.sort((x, y) => x.raw.distanceMiles - y.raw.distanceMiles);
}

/** Throws on anything but a 200 with a features array (the caller then leaves every stored row as it is, and the API stops showing them once stale). */
export async function fetchFires(town: SafetyTown, now = new Date(), fetcher: typeof fetch = fetch): Promise<FireNotice[]> {
  const q = new URLSearchParams({
    where: "IncidentTypeCategory='WF' AND FireOutDateTime IS NULL", geometry: `${town.lon},${town.lat}`, geometryType: 'esriGeometryPoint',
    inSR: '4326', distance: String(town.radiusMiles), units: 'esriSRUnit_StatuteMile', outFields: FIELDS, outSR: '4326', f: 'json',
  });
  const res = await fetcher(`${WFIGS_LAYER}/query?${q}`, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status !== 200) throw new Error(`WFIGS ${town.townId} -> HTTP ${res.status}`);
  const body = await res.json();
  if ((body as { error?: unknown })?.error) throw new Error(`WFIGS ${town.townId}: ${JSON.stringify((body as { error: unknown }).error).slice(0, 200)}`);
  return parseWfigs(body, town, now);
}
