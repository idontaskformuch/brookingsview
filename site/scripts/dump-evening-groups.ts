/** Dev-only: items and groups per evening for the next 14 evenings, per source (own events, Ticketmaster, venue register) and combined,
 *  plus the threshold verdict. Same assembly as pages/tonight.astro. Usage (from site/): SITE_CITY=glasgow npx vite-node --config vite-node.config.ts scripts/dump-evening-groups.ts */
import { getUpcomingStories, getUpcomingArtsEvents, getFacilities, getEveningRegister, getOsmSnapshot } from '../src/lib/db';
import { placesFromSnapshot, openLateCounts } from '../src/lib/osm-open-late';
import { localDayNumber, localHourOf } from '../src/lib/local-day';
import { EVENING_LAST_START_HOUR } from '../src/lib/evening-threshold';
import { buildEventFeed, isFreeEvent } from '../src/lib/events';
import { siteConfig } from '../src/lib/site-config';
import { getTicketmasterEventsForTown } from '../src/lib/ticketmaster';
import { buildEveningEntries, toThresholdItems } from '../src/lib/evening-items';
import { evaluateEveningThreshold, eveningNights } from '../src/lib/evening-threshold';

const layer = siteConfig.eveningLayer!;
const now = new Date();
const tz = siteConfig.timezone;
const [stories, arts, facilities] = await Promise.all([getUpcomingStories(['event'], 200), getUpcomingArtsEvents(60), getFacilities()]);
const { items } = buildEventFeed(stories, arts, tz);
const tm = siteConfig.hasWhatsOn ? await getTicketmasterEventsForTown(siteConfig, { includeSports: layer.includeTicketmasterSports }) : [];
let register = layer.register ? await getEveningRegister() : [];
// WHATIF='Cottiers=Comedy & shows;Òran Mór=Comedy & shows' remaps default groups per venue name (what-if only, nothing is saved).
const whatif = Object.fromEntries((process.env.WHATIF ?? '').split(';').filter(Boolean).map((p) => p.split('=')));
register = register.map((r) => ({ ...r, defaultGroup: whatif[r.venueName] ?? r.defaultGroup }));
const checked = now.toISOString().slice(0, 10);
const base = { now, timezone: tz, checked, cityName: siteConfig.cityName, isFree: (i: any) => isFreeEvent(i, facilities), ticketmasterMaxMiles: layer.maxMiles, includeTicketmasterSports: layer.includeTicketmasterSports };
const sets = {
  own: buildEveningEntries({ ...base, feed: items }),
  ticketmaster: buildEveningEntries({ ...base, feed: [], ticketmaster: tm }),
  register: buildEveningEntries({ ...base, feed: [], register }),
  all: buildEveningEntries({ ...base, feed: items, ticketmaster: tm, register }),
};
{
  const tmAll = tm.map((i) => i.ticketmasterEvent);
  const win = (d: Date) => d.getTime() >= now.getTime() && d.getTime() < now.getTime() + 14 * 86_400_000;
  const inWin = tm.filter((i) => i.occurs_at && win(new Date(i.occurs_at)));
  const hourOf = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));
  console.log(`
=== Ticketmaster funnel: fetched ${tmAll.length}; start within 14 days ${inWin.length}; of those 17:00 or later ${inWin.filter((i) => hourOf(i.occurs_at!) >= 17).length}; kept as evening entries ${sets.ticketmaster.length} (all dates)`);
  const ungrouped = sets.ticketmaster.filter((e) => !e.group);
  const by = new Map<string, number>();
  for (const e of ungrouped) { const ev = tmAll.find((x) => `tm:${x.id}` === e.id); const k = `${ev?.segment ?? '?'} / ${ev?.genre ?? '?'}`; by.set(k, (by.get(k) ?? 0) + 1); }
  console.log('   sample ungrouped:', ungrouped.slice(0, 40).map((e) => { const ev = tmAll.find((x) => `tm:${x.id}` === e.id); return `${ev?.segment}/${ev?.genre}: ${e.title}`; }).join(' | '));
  console.log('   ungrouped by segment / genre:', [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('; '));
}
for (const [name, entries] of Object.entries(sets)) {
  const nights = eveningNights(toThresholdItems(entries), now, tz);
  const v = evaluateEveningThreshold({ items: toThresholdItems(entries), now, timezone: tz, mode: layer.mode });
  console.log(`\n=== ${name}: ${entries.length} entries, median items ${v.medianItems}, median groups ${v.medianGroups}`);
  const groupTotals = new Map<string, number>();
  for (const e of entries) groupTotals.set(e.group ?? '(none)', (groupTotals.get(e.group ?? '(none)') ?? 0) + 1);
  console.log('   groups overall:', [...groupTotals].map(([g, n]) => `${g}=${n}`).join(', '));
  for (const n of nights) {
    const day = new Date(n.day * 86_400_000).toISOString().slice(0, 10);
    const per = new Map<string, number>();
    for (const e of entries) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(e.start));
      if (d === day && Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(e.start))) >= 17) per.set(e.group ?? '(none)', (per.get(e.group ?? '(none)') ?? 0) + 1);
    }
    console.log(`   ${day} items ${String(n.items).padStart(2)} groups ${n.groups}  ${[...per].map(([g, c]) => `${g}:${c}`).join('  ')}`);
  }
}
const regGroups = new Map<string, string>();
for (const r of register) regGroups.set(`${r.venueName} [${r.kind}] ${r.title}`, r.defaultGroup);
console.log('\n=== register rows (venue [kind] title -> default_group -> resolved group)');
for (const e of sets.register.slice(0, 0)) void e;
for (const [k, g] of regGroups) console.log('  ', k, '->', g);
// Verdict as the page computes it: Open late counts as one group on evenings with >= 3 places, never as items.
{
  const places = layer.openLate ? placesFromSnapshot(await getOsmSnapshot(), now) ?? [] : [];
  const first = localDayNumber(now, tz) + (localHourOf(now, tz) >= EVENING_LAST_START_HOUR ? 1 : 0);
  const openLateByDay = openLateCounts(places, first, 14, tz);
  const v = evaluateEveningThreshold({ items: toThresholdItems(sets.all), now, timezone: tz, mode: layer.mode, openLateByDay });
  console.log(`
=== VERDICT ${siteConfig.townId}: median items ${v.medianItems}, median groups ${v.medianGroups} (Open late counted as a group), indexable=${v.indexable} (${v.reason})`);
  console.log('   per evening items/groups:', v.nights.map((n) => `${n.items}/${n.groups}`).join(' '));
}
process.exit(0);
