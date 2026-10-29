/**
 * Dev-only check (not wired into the build): after the Ticketmaster fetch was changed to sort=date,asc (2026-10-29), do the big
 * arenas still lead the What's On marquee? Runs the real fetch + rankTicketmasterEvents + splitMarquee for SITE_CITY and prints the
 * fetched span (is the 5 x 200 cap reached, and how far ahead does it still reach?), the tier mix and the marquee.
 *
 *   SITE_CITY=glasgow npx vite-node --config vite-node.config.ts scripts/check-whats-on-ranking.ts
 */
import { siteConfig } from '../src/lib/site-config';
import { fetchTicketmasterEvents } from '../src/lib/ticketmaster';
import { rankTicketmasterEvents, splitMarquee } from '../src/lib/whats-on';
import { venueTierFor } from '../src/lib/venue-tiers';

async function main() {
  const tm = siteConfig.ticketmaster;
  if (!tm) { console.log(`${siteConfig.cityName}: no ticketmaster config`); return; }
  const items = await fetchTicketmasterEvents(tm.latitude, tm.longitude, tm.radiusMiles);
  const dated = items.filter((i) => i.occurs_at).sort((a, b) => +new Date(a.occurs_at!) - +new Date(b.occurs_at!));
  const last = dated.length ? new Date(dated[dated.length - 1].occurs_at!) : null;
  const days = last ? Math.round((+last - Date.now()) / 86_400_000) : 0;
  console.log(`\n${siteConfig.cityName}: ${items.length} events, last on ${last?.toISOString().slice(0, 10)} (${days} days ahead; cap 1000 raw)`);
  const tiers: Record<string, number> = {};
  for (const i of items) { const t = venueTierFor(siteConfig.townId, i.ticketmasterEvent.venueName, i.ticketmasterEvent.venueId); tiers[t] = (tiers[t] ?? 0) + 1; }
  console.log('tiers:', JSON.stringify(tiers));
  const ranked = rankTicketmasterEvents(items, siteConfig.townId);
  const { marquee } = splitMarquee(ranked) as { marquee: Array<{ primary: { ticketmasterEvent: { title: string; venueName: string | null; venueId: string | null }; occurs_at: string | null } }> };
  console.log('marquee:');
  for (const m of marquee) {
    const e = m.primary.ticketmasterEvent;
    console.log(`  ${(m.primary.occurs_at ?? '').slice(0, 10)}  ${venueTierFor(siteConfig.townId, e.venueName, e.venueId).padEnd(6)} ${(e.venueName ?? '').slice(0, 32).padEnd(32)} ${e.title.slice(0, 50)}`);
  }
}
main();
