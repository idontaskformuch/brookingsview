/** NWS active alerts for a town's forecast zones -- port of scrapers/parsers/nws_alerts.py (same fields, same content_hash). */
import { contentHash } from './hash';

export interface AlertRecord {
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  source: string;
  url: string | null;
  raw_data: Record<string, unknown>;
  content_hash: string;
}

export const NWS_API = 'https://api.weather.gov/alerts/active';
export const USER_AGENT = 'ViewMediaBot/1.0 (+https://brookingsview.com/contact)';

export async function parseNws(body: unknown): Promise<AlertRecord[]> {
  const features = (body as { features?: { properties?: Record<string, any> }[] })?.features ?? [];
  const out: AlertRecord[] = [];
  for (const feat of features) {
    const p = feat.properties ?? {};
    if (!p.id && !p['@id']) continue;
    out.push({
      title: p.event ?? null,
      starts_at: p.onset ?? p.effective ?? null,
      ends_at: p.ends ?? p.expires ?? null,
      venue: p.areaDesc ?? null,
      source: 'nws_alert',
      url: p['@id'] ?? null,
      raw_data: { severity: p.severity ?? null, headline: p.headline ?? null, description: p.description ?? null, instruction: p.instruction ?? null },
      content_hash: await contentHash('nws', p.id ?? p['@id']),
    });
  }
  return out;
}

/** One request for all of the town's zones. Throws on anything but a 200 with JSON (the caller then keeps the stored rows). */
export async function fetchNws(zones: string[], fetcher: typeof fetch = fetch): Promise<AlertRecord[]> {
  const res = await fetcher(`${NWS_API}?zone=${encodeURIComponent(zones.join(','))}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (res.status !== 200) throw new Error(`NWS ${zones.join(',')} -> HTTP ${res.status}`);
  return parseNws(await res.json());
}
