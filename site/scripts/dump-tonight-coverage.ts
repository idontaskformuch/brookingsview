/** Dev-only, read-only: field coverage of the evening entries and Open late rows for the active town over 24 h and 7 days, neighbourhoods,
 *  Ticketmaster Theatre-genre count, Open late coordinate status. Usage (from site/): SITE_CITY=broomfield_co npx vite-node --config vite-node.config.ts scripts/dump-tonight-coverage.ts */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities, getEveningRegister, getOsmSnapshot } from '../src/lib/db';
import { placesFromSnapshot, openLateRows, decorateOpenLate } from '../src/lib/osm-open-late';
import { localDayNumber } from '../src/lib/local-day';
import { buildEventFeed, isFreeEvent } from '../src/lib/events';
import { siteConfig } from '../src/lib/site-config';
import { getTicketmasterEventsForTown } from '../src/lib/ticketmaster';
import { buildEveningEntries } from '../src/lib/evening-items';
import { areasFor, withAreas } from '../src/lib/areas';

const layer = siteConfig.eveningLayer!;
const now = new Date();
const tz = siteConfig.timezone;
const [stories, arts, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
const { items } = buildEventFeed(stories, arts, tz);
const tm = siteConfig.hasWhatsOn ? await getTicketmasterEventsForTown(siteConfig, { includeSports: layer.includeTicketmasterSports }) : [];
const register = layer.register ? await getEveningRegister() : [];
const areaData = areasFor(siteConfig.townId);
const checked = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
const entries = withAreas(buildEveningEntries({
  feed: items, ticketmaster: tm, register, now, timezone: tz, checked, cityName: siteConfig.cityName, townId: siteConfig.townId, venueMiles: areaData?.venueMiles,
  isFree: (i) => isFreeEvent(i, facilities), ticketmasterMaxMiles: layer.maxMiles, includeTicketmasterSports: layer.includeTicketmasterSports,
}), areaData);

console.log(`\n##### ${siteConfig.townId} tz=${tz} now=${now.toISOString()} openLate=${!!layer.openLate} register=${!!layer.register} areaFile=${!!areaData} maxMiles=${layer.maxMiles}`);
console.log(`raw: own feed ${items.length}, TM fetched ${tm.length}, register rows ${register.length}`);
const pct = (n: number, d: number) => (d === 0 ? '  n/a' : `${Math.round((100 * n) / d)}%`.padStart(5)) + ` (${n}/${d})`;
for (const [label, hours] of [['24 h', 24], ['7 days', 168]] as const) {
  const t0 = now.getTime(), t1 = t0 + hours * 3_600_000;
  const w = entries.filter((e) => { const s = new Date(e.start).getTime(); return s >= t0 && s < t1; });
  console.log(`\n== EVENTS ${label}: ${w.length} entries (by source: ${['own', 'ticketmaster', 'register'].map((s) => `${s}=${w.filter((e) => e.source === s).length}`).join(', ')})`);
  for (const src of [null, 'own', 'ticketmaster', 'register'] as const) {
    const s = src ? w.filter((e) => e.source === src) : w;
    if (src && s.length === 0) continue;
    const c = (f: (e: (typeof w)[number]) => boolean) => pct(s.filter(f).length, s.length);
    console.log(`  [${src ?? 'ALL'}] start ${c(() => true)} | category ${c((e) => !!e.group)} | area ${c((e) => !!e.area)} | coords ${c((e) => e.lat != null && e.lon != null)} | end ${c((e) => !!e.end)} | price ${c((e) => e.priceMin != null)} | Free ${c((e) => e.labels.includes('Free'))} | age ${c((e) => e.labels.some((l) => l !== 'Free'))} | ticket status 0 (no source)`);
  }
  const priceNums = w.filter((e) => e.priceMin != null);
  if (priceNums.length) console.log(`  price sample: ${priceNums.slice(0, 5).map((e) => `${e.title.slice(0, 30)}=${e.priceMin} ${e.priceCurrency}`).join(' | ')}`);
}
const osmSnap = await getOsmSnapshot();
const osm = placesFromSnapshot(osmSnap, now) ?? [];
console.log(`\n== OPEN LATE: snapshot ${osmSnap ? `fetched ${osmSnap.fetchedAt}, ${osmSnap.elements.length} elements, ${osm.length} places parsed` : 'NONE in DB'}; coordinates ${pct(osm.filter((p) => p.lat != null && p.lon != null).length, osm.length)}`);
const today = localDayNumber(now, tz);
const lateAll: ReturnType<typeof decorateOpenLate> = [];
for (let d = 0; d < 7; d++) {
  const rows = decorateOpenLate(openLateRows(osm, today + d, tz, Number.MAX_SAFE_INTEGER), siteConfig.townId, areaData);
  if (d === 0) console.log(`  tonight open-late rows ${rows.length}, with coords ${pct(rows.filter((r) => r.lat != null).length, rows.length)}, with area ${pct(rows.filter((r) => r.area).length, rows.length)}`);
  lateAll.push(...rows);
}
console.log(`  7 days open-late rows (place-nights) ${lateAll.length}, area ${pct(lateAll.filter((r) => r.area).length, lateAll.length)}`);

const t7 = now.getTime() + 168 * 3_600_000;
const ev7 = entries.filter((e) => { const s = new Date(e.start).getTime(); return s >= now.getTime() && s < t7; });
const by = new Map<string, { ev: number; late: number }>();
const bump = (k: string, f: 'ev' | 'late') => { const v = by.get(k) ?? { ev: 0, late: 0 }; v[f]++; by.set(k, v); };
for (const e of ev7) bump(e.area ?? '(no area)', 'ev');
for (const r of lateAll) bump(r.area ?? '(no area)', 'late');
console.log(`\n== NEIGHBOURHOODS 7 days (events / open-late place-nights):`);
for (const [k, v] of [...by].sort((a, b) => b[1].ev + b[1].late - a[1].ev - a[1].late)) console.log(`  ${k.padEnd(28)} events ${String(v.ev).padStart(3)}  late ${String(v.late).padStart(3)}  total ${v.ev + v.late}`);
console.log(`  distinct areas (excl. none): ${[...by.keys()].filter((k) => k !== '(no area)').length}`);

const tm7 = tm.filter((i) => i.occurs_at && new Date(i.occurs_at).getTime() >= now.getTime() && new Date(i.occurs_at).getTime() < t7).map((i) => i.ticketmasterEvent);
const inEntries = new Set(ev7.map((e) => e.id));
const th = tm7.filter((e) => e.genre === 'Theatre');
const thKept = th.filter((e) => inEntries.has(`tm:${e.id}`));
console.log(`\n== THEATRE genre (TM, 7 d): ${th.length} events fetched, ${thKept.length} inside maxMiles/evening entries, ${new Set(thKept.map((e) => e.title)).size} distinct titles. segments/genres 7d: ${[...tm7.reduce((m, e) => m.set(`${e.segment}/${e.genre}`, (m.get(`${e.segment}/${e.genre}`) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}=${n}`).join('; ')}`);
process.exit(0);
