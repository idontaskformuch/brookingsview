/** The one pipeline from stored events to what /events/ and the front page show: ended events out, cross-source merge, in-town / nearby / unknown
 *  split, then the local-day view (event-day-view.ts). Both pages call this, so a count on the front page can never disagree with /events/. */
import { buildEventFeed, classifyEventLocality, type FeedItem } from './events';
import { withoutEnded, countEventsToday } from './local-day';
import { buildEntries, countable, type EventEntry } from './event-entries';
import { buildEventsView, DAY_WINDOW, isOwnEvent, type DayRow, type EventsView } from './event-day-view';
import { makeRowFacts } from './event-row-facts';
import { areasFor } from './areas';
import { siteConfig } from './site-config';
import type { Story, SdsuEvent, Facility } from './db';
import type { TicketmasterFeedItem } from './ticketmaster';
import { TM_ASSUMED_HOURS } from './today-shows';

/** The Ticketmaster listings a town's event lists take (owner 2026-11-26): sport only where the town's evening layer takes it
 *  (siteConfig.eveningLayer.includeTicketmasterSports), and not a show that started more than TM_ASSUMED_HOURS ago (Ticketmaster gives no
 *  end). Which of them are in town, nearby or outside is classifyEventLocality's call, as for every other event. */
export function ticketmasterForTown(items: TicketmasterFeedItem[], now: Date): TicketmasterFeedItem[] {
  const sports = siteConfig.eveningLayer?.includeTicketmasterSports ?? false;
  return items.filter((i) => i.occurs_at
    && (sports || i.ticketmasterEvent.segment !== 'Sports')
    && new Date(i.occurs_at).getTime() + TM_ASSUMED_HOURS * 3_600_000 > now.getTime());
}

export interface TownEventsView {
  view: EventsView;
  nearbyRows: DayRow[];
  /** miles for a row's item, nearby rows only */
  distanceOf: Map<FeedItem, number | null>;
  alsoListedBy: Map<FeedItem, string[]>;
  /** everything the page shows, in page order (days, further out, nearby) */
  displayed: FeedItem[];
  /** THE events-today count (lib/local-day.ts countEventsToday) at `now`: the town, and neighbouring towns separately */
  today: { town: number; nearby: number };
}

export interface TownEntries {
  /** in town (and unknown locality, folded in unlabeled) */
  here: EventEntry[];
  nearby: EventEntry[];
  alsoListedBy: Map<FeedItem, string[]>;
  distanceOf: Map<FeedItem, number | null>;
}

/** The one pipeline from stored events to entries (Designsystem Fas 2, owner 2026-11-20): ended stories out, cross-source merge, in-town /
 *  nearby split, then same-day dedup and series (lib/event-entries.ts). The header ticker (lib/today-instants.ts), /today/ and /events/
 *  (and the front page) all start here, and all count with countEventsToday(). */
export function buildTownEntries(stories: Story[], arts: SdsuEvent[], facilities: Facility[], now = new Date(), ticketmaster: TicketmasterFeedItem[] = []): TownEntries {
  // Ticketmaster (owner 2026-11-26): the town's own sport rule (eveningLayer.includeTicketmasterSports, as /tonight), shows already over out.
  const tm = ticketmasterForTown(ticketmaster, now);
  const { items, alsoListedBy } = buildEventFeed(withoutEnded(stories, now, siteConfig.timezone), arts, siteConfig.timezone, tm);
  const localized = items.map((item) => ({
    item,
    ...classifyEventLocality(item, facilities, siteConfig.townId, siteConfig.cityName, siteConfig.townCenter),
  }));
  // "unknown" locality (neither in town nor confirmed nearby) is folded in unlabeled, never dropped (owner fix 2026-10-08).
  // 'outside' (a Ticketmaster venue beyond the nearby radius) is in neither list.
  const here = localized.filter((l) => l.zone === 'in_town' || l.zone === 'unknown').map((l) => l.item);
  const nearby = localized.filter((l) => l.zone === 'nearby');
  return {
    here: buildEntries(here, siteConfig.timezone),
    nearby: buildEntries(nearby.map((l) => l.item), siteConfig.timezone),
    alsoListedBy,
    distanceOf: new Map(nearby.map((l) => [l.item, l.distanceMiles ?? null])),
  };
}

/** Serialisable entries for the browser's count (header ticker): in town, then nearby flagged. */
export function countableEntries(t: Pick<TownEntries, 'here' | 'nearby'>) {
  // Own events only (isOwnEvent): Ticketmaster listings are never in a count (owner 2026-11-26).
  return [...t.here.filter((e) => isOwnEvent(e.item)).map((e) => countable(e)), ...t.nearby.filter((e) => isOwnEvent(e.item)).map((e) => countable(e, true))];
}

export function buildTownEventsView(stories: Story[], arts: SdsuEvent[], facilities: Facility[], now = new Date(), ticketmaster: TicketmasterFeedItem[] = []): TownEventsView {
  const t = buildTownEntries(stories, arts, facilities, now, ticketmaster);
  const opts = {
    now, timezone: siteConfig.timezone, gb: siteConfig.country === 'gb',
    facts: makeRowFacts({ cityName: siteConfig.cityName, facilities, areas: areasFor(siteConfig.townId) }),
  };
  // A Ticketmaster listing is shown for the page's own days only (DAY_WINDOW): further out, the full list is What's On. Broomfield's
  // /events/ was 56,000 px tall with 60 days of Denver shows (2026-11-26).
  const inWindow = (r: DayRow) => isOwnEvent(r.item) || r.offset < DAY_WINDOW;
  const allView = buildEventsView(t.here, opts);
  const view = { ...allView, furtherOut: allView.furtherOut.filter(inWindow) };
  const nearbyView = buildEventsView(t.nearby, opts);
  const nearbyRows = [...nearbyView.days.flatMap((d) => d.rows), ...nearbyView.furtherOut].filter(inWindow);
  return {
    view, nearbyRows, alsoListedBy: t.alsoListedBy,
    distanceOf: t.distanceOf,
    displayed: [...view.days.flatMap((d) => d.rows.map((r) => r.item)), ...view.furtherOut.map((r) => r.item), ...nearbyRows.map((r) => r.item)],
    today: countEventsToday(countableEntries(t), now, siteConfig.timezone),
  };
}
