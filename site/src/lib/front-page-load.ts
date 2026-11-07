/** Build-time data for the daily front page: the evening rows ("tonight" / "this weekend") built exactly as /tonight and /this-weekend build them, so
 *  a count on the front page agrees with those pages. Towns without an evening layer have none (the selector then has no tonight/weekend item). */
import { getEveningRegister, type Facility } from './db';
import { siteConfig } from './site-config';
import { isFreeEvent, ownVenueCity, type FeedItem } from './events';
import { getTicketmasterEventsForTown } from './ticketmaster';
import { buildEveningEntries, type EveningEntry } from './evening-items';
import { areasFor, withAreas } from './areas';

export async function loadEveningForFrontPage(feed: FeedItem[], facilities: Facility[], now: Date): Promise<EveningEntry[]> {
  const layer = siteConfig.eveningLayer;
  if (!layer) return [];
  const tz = siteConfig.timezone;
  const tm = siteConfig.hasWhatsOn ? await getTicketmasterEventsForTown(siteConfig, { includeSports: layer.includeTicketmasterSports }) : [];
  const register = layer.register ? await getEveningRegister() : [];
  const checked = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const areaData = areasFor(siteConfig.townId);
  return withAreas(buildEveningEntries({
    feed, ticketmaster: tm, register, now, timezone: tz, checked, cityName: siteConfig.cityName, townId: siteConfig.townId, venueMiles: areaData?.venueMiles,
    isFree: (i) => isFreeEvent(i, facilities),
    venueCity: (i) => ownVenueCity(i, facilities),
    ticketmasterMaxMiles: layer.maxMiles,
    includeTicketmasterSports: layer.includeTicketmasterSports,
  }), areaData);
}
