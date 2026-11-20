/** The one pipeline from stored events to what /events/ and the front page show: ended events out, cross-source merge, in-town / nearby / unknown
 *  split, then the local-day view (event-day-view.ts). Both pages call this, so a count on the front page can never disagree with /events/. */
import { buildEventFeed, classifyEventLocality, type FeedItem } from './events';
import { withoutEnded, countEventsToday } from './local-day';
import { buildEntries, countable, type EventEntry } from './event-entries';
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
export function buildTownEntries(stories: Story[], arts: SdsuEvent[], facilities: Facility[], now = new Date()): TownEntries {
  const { items, alsoListedBy } = buildEventFeed(withoutEnded(stories, now, siteConfig.timezone), arts, siteConfig.timezone);
  const localized = items.map((item) => ({
    item,
    ...classifyEventLocality(item, facilities, siteConfig.townId, siteConfig.cityName, siteConfig.townCenter),
  }));
  // "unknown" locality (neither in town nor confirmed nearby) is folded in unlabeled, never dropped (owner fix 2026-10-08).
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
  return [...t.here.map((e) => countable(e)), ...t.nearby.map((e) => countable(e, true))];
}

export function buildTownEventsView(stories: Story[], arts: SdsuEvent[], facilities: Facility[], now = new Date()): TownEventsView {
  const t = buildTownEntries(stories, arts, facilities, now);
  const opts = {
    now, timezone: siteConfig.timezone, gb: siteConfig.country === 'gb',
    facts: makeRowFacts({ cityName: siteConfig.cityName, facilities, areas: areasFor(siteConfig.townId) }),
  };
  const view = buildEventsView(t.here, opts);
  const nearbyView = buildEventsView(t.nearby, opts);
  const nearbyRows = [...nearbyView.days.flatMap((d) => d.rows), ...nearbyView.furtherOut];
  return {
    view, nearbyRows, alsoListedBy: t.alsoListedBy,
    distanceOf: t.distanceOf,
    displayed: [...view.days.flatMap((d) => d.rows.map((r) => r.item)), ...view.furtherOut.map((r) => r.item), ...nearbyRows.map((r) => r.item)],
    today: countEventsToday(countableEntries(t), now, siteConfig.timezone),
  };
}
