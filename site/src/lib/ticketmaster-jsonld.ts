/** What's On Phase 5 -- Event JSON-LD for a Ticketmaster-sourced detail
 *  page. A separate builder from lib/event-jsonld.ts's buildEventJsonLd()
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

/**
 * Returns the Event JSON-LD object for a Ticketmaster item, or null when
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
  canonicalUrl: string,
  siteName: string,
): Record<string, unknown> | null {
  if (!item.occurs_at) return null;
  const e = item.ticketmasterEvent;

  const hasAddress = Boolean(e.venueName && e.venueAddress && e.venueCity && e.venueStateCode);
  const location = hasAddress ? {
    '@type': 'Place',
    name: e.venueName,
    address: {
      '@type': 'PostalAddress',
      streetAddress: e.venueAddress,
      addressLocality: e.venueCity,
      addressRegion: e.venueStateCode,
      postalCode: e.venuePostalCode ?? undefined,
      addressCountry: 'US',
    },
    ...(e.venueLatitude != null && e.venueLongitude != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: e.venueLatitude, longitude: e.venueLongitude } }
      : {}),
  } : undefined;

  const offers = e.priceMin != null ? {
    '@type': 'Offer',
    url: e.ticketUrl || undefined,
    price: e.priceMin,
    priceCurrency: e.priceCurrency ?? 'USD',
    availability: 'https://schema.org/InStock',
  } : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': canonicalUrl,
    url: canonicalUrl,
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
