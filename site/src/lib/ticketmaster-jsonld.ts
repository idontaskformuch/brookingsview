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
  siteName: string,
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

  const offers = e.priceMin != null ? {
    '@type': 'Offer',
    url: ticketUrl ?? undefined,
    price: e.priceMin,
    priceCurrency: e.priceCurrency ?? 'USD',
    availability: 'https://schema.org/InStock',
  } : undefined;

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
    ...(offers ? { offers } : {}),
    // The venue is the most defensible organizer without inventing a fact
    // (same reasoning buildEventJsonLd() already applies) -- falls back to
    // the site itself when even the venue name is unknown.
    organizer: { '@type': 'Organization', name: e.venueName ?? siteName },
  };
}

/** The /whats-on/ listing's events as one ItemList, in the order the page shows them. Items without a date get no Event and
 *  are left out; null when none is left. */
export function buildTicketmasterListJsonLd(
  items: TicketmasterFeedItem[],
  pageUrl: string,
  siteName: string,
): Record<string, unknown> | null {
  const events = items.flatMap((item) => {
    const ld = buildTicketmasterEventJsonLd(item, pageUrl, siteName);
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
