/** Met Office NSWWS (DataHub v1.1) -- port of scrapers/parsers/met_office_warnings_v1.py. A warning is kept only when the town's point
 *  lies inside its polygon. One events row per warningId, overwritten in place by newer versions / EXPIRED / CANCELLED. */
import { contentHash } from './hash';
import type { AlertRecord } from './nws';

export const FEED_URL = 'https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/feed';
export const PUBLIC_WARNINGS_URL = 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings';
export const SOURCE = 'met_office_warning';
const MAX_UPDATE_FETCHES = 100;

type Ring = number[][];
type Geometry = { type?: string; coordinates?: any } | null | undefined;
type Props = Record<string, any>;

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** GeoJSON (lon, lat) order. Polygon and MultiPolygon, holes respected. */
export function pointInGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (!geometry) return false;
  const polygons: Ring[][] =
    geometry.type === 'Polygon' ? [geometry.coordinates ?? []] : geometry.type === 'MultiPolygon' ? geometry.coordinates ?? [] : [];
  for (const poly of polygons) {
    if (!poly.length) continue;
    if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole))) return true;
  }
  return false;
}

const attr = (tag: string, name: string): string | null => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** Atom feed -> the "related" snapshot link and the update entries (oldest first). Regex, because Workers have no DOMParser. */
export function parseFeed(xml: string): { related: string | null; entries: { updated: string; href: string }[] } {
  const topLevel = xml.replace(/<entry\b[\s\S]*?<\/entry>/g, '');
  let related: string | null = null;
  for (const m of topLevel.matchAll(/<link\b[^>]*>/g)) if (attr(m[0], 'rel') === 'related') related = attr(m[0], 'href');
  const entries: { updated: string; href: string }[] = [];
  for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const link = [...m[0].matchAll(/<link\b[^>]*>/g)].map((l) => l[0]).find((l) => attr(l, 'rel') === 'alternate');
    const href = link ? attr(link, 'href') : null;
    const updated = /<updated>([^<]*)<\/updated>/.exec(m[0])?.[1] ?? '';
    if (href) entries.push({ updated, href });
  }
  entries.sort((a, b) => a.updated.localeCompare(b.updated));
  return { related, entries };
}

const asList = (v: unknown): string[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  const t = String(v).trim();
  if (t.startsWith('[')) {
    try {
      const j = JSON.parse(t.replace(/'/g, '"'));
      if (Array.isArray(j)) return j.map(String);
    } catch {
      /* fall through to the plain string */
    }
  }
  return t ? [t] : [];
};
const versionOf = (p: Props): number => (Number.isFinite(Number(p.warningVersion)) ? Number(p.warningVersion) : 0);
const sortKey = (p: Props): string => `${p.modifiedDate ?? ''}|${String(versionOf(p)).padStart(8, '0')}`;

/** Newest state of each warningId: latest modifiedDate, then version. */
export function newestPerWarning(features: { properties?: Props }[]): Map<string, { properties: Props }> {
  const best = new Map<string, { properties: Props }>();
  for (const f of features) {
    const p = f.properties ?? {};
    if (!p.warningId) continue;
    const cur = best.get(p.warningId);
    if (!cur || sortKey(p) >= sortKey(cur.properties)) best.set(p.warningId, { properties: p });
  }
  return best;
}

export async function toRecord(feat: { properties: Props }): Promise<AlertRecord> {
  const p = feat.properties;
  let areas: unknown = p.affectedAreas;
  if (typeof areas === 'string') {
    try {
      areas = JSON.parse(areas.replace(/'/g, '"'));
    } catch {
      areas = [];
    }
  }
  const regions = (Array.isArray(areas) ? areas : []).filter((a: any) => a && a.regionName).map((a: any) => a.regionName as string);
  return {
    title: p.warningHeadline ?? null,
    starts_at: p.validFromDate ?? null,
    ends_at: p.validToDate ?? null,
    venue: null,
    source: SOURCE,
    url: PUBLIC_WARNINGS_URL,
    raw_data: {
      warning_id: p.warningId,
      version: p.warningVersion ?? null,
      status: String(p.warningStatus ?? '').toUpperCase(),
      level: String(p.warningLevel ?? '').toLowerCase(),
      weather_types: asList(p.weatherType),
      likelihood: p.warningLikelihood ?? null,
      impact: p.warningImpact ?? null,
      headline: p.warningHeadline ?? null,
      what_to_expect: asList(p.whatToExpect),
      what_should_i_do: p.whatShouldIDo ?? null,
      further_details: p.warningFurtherDetails ?? null,
      update_description: p.warningUpdateDescription ?? null,
      issued: p.issuedDate ?? null,
      modified: p.modifiedDate ?? null,
      regions,
    },
    content_hash: await contentHash(SOURCE, p.warningId),
  };
}

/** Whole fetch for one point. Throws when every sub-request failed (the caller then leaves the stored rows alone). */
export async function fetchMetOffice(lat: number, lon: number, apiKey: string, fetcher: typeof fetch = fetch): Promise<AlertRecord[]> {
  const get = async (url: string): Promise<Response> => {
    const r = await fetcher(url, { headers: { apikey: apiKey, 'User-Agent': 'ViewMediaBot/1.0 (+https://glasgowloop.co.uk)' } });
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return r;
  };
  const { related, entries } = parseFeed(await (await get(FEED_URL)).text());
  const sources = [...(related ? [related] : []), ...entries.slice(-MAX_UPDATE_FETCHES).map((e) => e.href)];
  const features: { properties: Props }[] = [];
  let failed = 0;
  let lastError = '';
  for (const href of sources) {
    try {
      const data = (await (await get(href)).json()) as { features?: { geometry?: Geometry; properties?: Props }[] };
      for (const f of data.features ?? []) if (pointInGeometry(lon, lat, f.geometry)) features.push({ properties: f.properties ?? {} });
    } catch (e) {
      failed++;
      lastError = String(e);
    }
  }
  if (sources.length && failed === sources.length) throw new Error(`all NSWWS requests failed: ${lastError}`);
  return Promise.all([...newestPerWarning(features).values()].map(toRecord));
}
