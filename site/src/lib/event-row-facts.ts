/** Per-item facts for an /events/ row that come from outside the start time: the cleaned title, the venue, the neighbourhood, free and kids.
 *  Free: the source's structured cost line decides when there is one ("Free ..." on Glasgow Life), the venue rule (isFreeEvent) only when the
 *  source gave none. Kids: isKidsEvent (gb: the source's own "Kids & families" tag). Nothing here reads the story text for a date. */
import { isFreeEvent, isKidsEvent, type FeedItem } from './events';
import { isFreeByCost, type RowFacts } from './event-day-view';
import { buildNameAliasIndex, splitEventTitleAndVenue } from './images';
import { buildVenueIndex, resolveVenue, type Facility } from './db';
import { nearestArea, normVenue, type AreaData } from './areas';

export interface FactsContext {
  cityName: string;
  facilities: Facility[];
  areas: AreaData | null;
}

export function makeRowFacts(ctx: FactsContext): (item: FeedItem) => RowFacts {
  const aliasIndex = buildNameAliasIndex(ctx.facilities);
  const venueIndex = buildVenueIndex(ctx.facilities);
  return (item) => {
    if (item.sourceKind === 'arts') {
      const venue = item.event.location || null;
      return { title: item.event.title, venue, area: null, free: false, kids: isKidsEvent(item) };
    }
    const { story } = item;
    const { displayTitle, venue: titleVenue } = splitEventTitleAndVenue(story.title, ctx.cityName, aliasIndex);
    const facility = resolveVenue(venueIndex, story.venue_raw);
    const venue = titleVenue ?? story.meta?.venue ?? facility?.name ?? null;
    const byCoords = ctx.areas && facility?.lat != null && facility?.lon != null ? nearestArea(facility.lat, facility.lon, ctx.areas.areas) : null;
    const area = byCoords ?? (ctx.areas && venue ? ctx.areas.venues[normVenue(venue)] ?? null : null);
    const byCost = isFreeByCost(story.meta?.cost);
    return { title: displayTitle, venue, area, free: byCost ?? isFreeEvent(item, ctx.facilities), kids: isKidsEvent(item) };
  };
}
