/** Dev-only: every venue string the evening layer sees per source, grouped by accent/case/punctuation-insensitive key, so spelling
 *  variants of one venue ("Oran Mor" / "Òran Mór") can be put into src/config/venue-names.json. Usage (from site/):
 *  SITE_CITY=glasgow npx vite-node --config vite-node.config.ts scripts/dump-venue-names.ts */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities, getEveningRegister, getOsmSnapshot } from '../src/lib/db';
import { placesFromSnapshot } from '../src/lib/osm-open-late';
import { buildEventFeed, isFreeEvent } from '../src/lib/events';
import { siteConfig } from '../src/lib/site-config';
import { getTicketmasterEventsForTown } from '../src/lib/ticketmaster';
import { buildEveningEntries } from '../src/lib/evening-items';

const layer = siteConfig.eveningLayer!;
const now = new Date();
const [stories, arts, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
const { items } = buildEventFeed(stories, arts, siteConfig.timezone);
const tm = siteConfig.hasWhatsOn ? await getTicketmasterEventsForTown(siteConfig, { includeSports: layer.includeTicketmasterSports }) : [];
const register = layer.register ? await getEveningRegister() : [];
const entries = buildEveningEntries({ feed: items, ticketmaster: tm, register, now, timezone: siteConfig.timezone, checked: now.toISOString().slice(0, 10), cityName: siteConfig.cityName,
  isFree: (i: any) => isFreeEvent(i, facilities), ticketmasterMaxMiles: layer.maxMiles, includeTicketmasterSports: layer.includeTicketmasterSports });
const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, ' ').trim();
const seen = new Map<string, Map<string, string>>();
const add = (name: string | null | undefined, src: string) => { if (!name) return; const k = key(name); const m = seen.get(k) ?? new Map(); m.set(name, `${m.get(name) ?? ''}${src[0]}`); seen.set(k, m); };
for (const e of entries) add(e.venue, e.source);
for (const p of placesFromSnapshot(await getOsmSnapshot(), now) ?? []) add(p.name, 'osm');
console.log(`${siteConfig.cityName}: ${seen.size} distinct venues`);
for (const [k, m] of seen) if (m.size > 1) console.log('VARIANTS', k, '=>', [...m.keys()].map((n) => JSON.stringify(n)).join(' | '));
console.log('ALL', [...seen.values()].map((m) => [...m.keys()][0]).sort().join(' ; '));
