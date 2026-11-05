/** The one pipeline from stored events to what /events/ and the front page show: ended events out, cross-source merge, in-town / nearby / unknown
 *  split, then the local-day view (event-day-view.ts). Both pages call this, so a count on the front page can never disagree with /events/. */
import { buildEventFeed, classifyEventLocality, type FeedItem } from './events';
import { withoutEnded } from './local-day';
import { buildEventsView, type DayRow, type EventsView } from './event-day-view';
import { makeRowFacts } from './event-row-facts';
import { areasFor } from './areas';
import { siteConfig } from './site-config';
import type { Story, SdsuEvent, Facility } from './db';

export interface TownEventsView {
  view: EventsView;
  nearbyRows: DayRow[];
  /** miles for a row's item, nearby rows only */
  distanceOf: Map<FeedItem, number | null>;
  alsoListedBy: Map<FeedItem, string[]>;
  /** everything the page shows, in page order (days, further out, nearby) */
  displayed: FeedItem[];
}

export function buildTownEventsView(stories: Story[], arts: SdsuEvent[], facilities: Facility[], now = new Date()): TownEventsView {
  const { items, alsoListedBy } = buildEventFeed(withoutEnded(stories, now, siteConfig.timezone), arts, siteConfig.timezone);
  const localized = items.map((item) => ({
    item,
    ...classifyEventLocality(item, facilities, siteConfig.townId, siteConfig.cityName, siteConfig.townCenter),
  }));
  // "unknown" locality (neither in town nor confirmed nearby) is folded in unlabeled, never dropped (owner fix 2026-10-08).
  const here = localized.filter((l) => l.zone === 'in_town' || l.zone === 'unknown').map((l) => l.item);
  const nearby = localized.filter((l) => l.zone === 'nearby');
  const opts = {
    now, timezone: siteConfig.timezone, gb: siteConfig.country === 'gb',
    facts: makeRowFacts({ cityName: siteConfig.cityName, facilities, areas: areasFor(siteConfig.townId) }),
  };
  const view = buildEventsView(here, opts);
  const nearbyView = buildEventsView(nearby.map((l) => l.item), opts);
  const nearbyRows = [...nearbyView.days.flatMap((d) => d.rows), ...nearbyView.furtherOut];
  return {
    view, nearbyRows, alsoListedBy,
    distanceOf: new Map(nearby.map((l) => [l.item, l.distanceMiles ?? null])),
    displayed: [...view.days.flatMap((d) => d.rows.map((r) => r.item)), ...view.furtherOut.map((r) => r.item), ...nearbyRows.map((r) => r.item)],
  };
}
