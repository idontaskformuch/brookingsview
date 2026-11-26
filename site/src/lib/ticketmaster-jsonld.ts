/** What's On Phase 5 -- Event JSON-LD for Ticketmaster events. Since SPEC Fas 13a (2026-11-16) there is no detail page:
 *  the events sit on the /whats-on/ listing as one ItemList (buildTicketmasterListJsonLd), each Event with an anchor on
 *  that page as @id and its ticket page as url. A separate builder from lib/event-jsonld.ts's buildEventJsonLd()
 *  rather than a reuse/extension of it: that function resolves location
 *  ONLY via this codebase's own `facilities` table (resolveVenue()) or a
 *  virtual-event heuristic -- neither applies here. A Ticketmaster venue
 *  (Sioux Falls' Denny Sanford PREMIER Center, say) is never in the local
 *  facilities table, so buildEventJsonLd() would resolve `location` to
 *  null and return null for every real Ticketmaster event, not because the
 *  venue is unknown but because it's looking in the wrong place. This
 *  builder trusts Discovery API's own venue address/geo data instead --
 *  see lib/ticketmaster.ts's TicketmasterEvent for where that comes from.
 */
import type { TicketmasterFeedItem } from './ticketmaster';
import { ticketmasterHref } from './whats-on';
import { offerField, organizerField, placeDescription } from './event-jsonld-fields';

/**
 * Returns the Event JSON-LD object for a Ticketmaster item listed on `pageUrl`, or null when
 * there's no date to anchor an Event on (schema.org requires startDate).
 * Location is included only when Discovery API supplied real venue
 * address data -- an event with a venue NAME but no resolved address
 * (confirmed this happens live) omits `location` entirely rather than
 * emitting a Place with a fabricated or missing PostalAddress, the same
 * "never ship a placeholder address" rule buildEventJsonLd() already
 * enforces for local venues.
 */
export function buildTicketmasterEventJsonLd(
  item: TicketmasterFeedItem,
  pageUrl: string,
): Record<string, unknown> | null {
  if (!item.occurs_at) return null;
  const e = item.ticketmasterEvent;
  const ticketUrl = ticketmasterHref(e);

  const country = e.venueCountryCode ?? 'US';
  // US venues need a state; UK venues have none (Discovery returns state: null
  // for Glasgow) and are identified by city + postcode instead.
  const hasAddress = Boolean(
    e.venueName && e.venueAddress && e.venueCity && (e.venueStateCode || (country !== 'US' && e.venuePostalCode)),
  );
  const location = hasAddress ? {
    '@type': 'Place',
    name: e.venueName,
    address: {
      '@type': 'PostalAddress',
      streetAddress: e.venueAddress,
      addressLocality: e.venueCity,
      addressRegion: e.venueStateCode ?? undefined,
      postalCode: e.venuePostalCode ?? undefined,
      addressCountry: country,
    },
    ...(e.venueLatitude != null && e.venueLongitude != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: e.venueLatitude, longitude: e.venueLongitude } }
      : {}),
  } : undefined;

  // Offers only with a price AND Discovery's public on-sale date (validFrom); without that date no offers (owner 2026-11-26).
  const offers = offerField({ price: e.priceMin, currency: e.priceCurrency ?? (e.priceMin != null ? 'USD' : null), validFrom: e.onSaleFrom, url: ticketUrl });
  const organizer = organizerField(e.promoterName);
  const description = placeDescription(e.title, e.venueName, e.venueCity);

  // Performer (Search Console, owner 2026-11-18: only from the source's own fields): Discovery's attractions are the acts for music and
  // comedy; for theatre, family shows and sport an attraction is the production or a team, not a performer, so those get none.
  const performs = e.segment === 'Music' || e.genre === 'Comedy';
  const performer = performs && e.attractionNames && e.attractionNames.length > 0
    ? e.attractionNames.map((name) => ({ '@type': 'PerformingGroup', name }))
    : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${pageUrl}#tm-${e.id}`,
    url: ticketUrl ?? pageUrl,
    name: e.title,
    startDate: item.occurs_at,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(location ? { location } : {}),
    ...(e.imageUrl ? { image: [e.imageUrl] } : {}),
    ...(description ? { description } : {}),
    ...(offers ? { offers } : {}),
    ...(performer ? { performer: performer.length === 1 ? performer[0] : performer } : {}),
    // Organizer only when Discovery names the promoter (owner 2026-11-26); never the venue repeated (owner 2026-11-16).
    ...(organizer ? { organizer } : {}),
  };
}

/** Days ahead the /whats-on/ ItemList covers. Every listed card (30-60 days) added 210-290 kB to the page in Glasgow and
 *  Broomfield (2026-11-16 builds); the owner's limit was 100 kB, so the markup covers the next 14 days only. */
export const LIST_JSON_LD_DAYS = 14;

/** The /whats-on/ listing's events as one ItemList, in the order the page shows them: only those starting from `now` to
 *  LIST_JSON_LD_DAYS ahead. Items without a date get no Event and are left out; null when none is left. */
export function buildTicketmasterListJsonLd(
  items: TicketmasterFeedItem[],
  pageUrl: string,
  now: Date,
): Record<string, unknown> | null {
  const last = now.getTime() + LIST_JSON_LD_DAYS * 86_400_000;
  const events = items.flatMap((item) => {
    if (!item.occurs_at || new Date(item.occurs_at).getTime() > last) return [];
    const ld = buildTicketmasterEventJsonLd(item, pageUrl);
    if (!ld) return [];
    const { '@context': _context, ...event } = ld;
    return [event];
  });
  if (events.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: pageUrl,
    numberOfItems: events.length,
    itemListElement: events.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
}
