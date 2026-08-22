/**
 * Event JSON-LD emission decision tree -- see NEEDS-HUMAN-REVIEW.md, "Event
 * JSON-LD venue resolution & emission rules". Every event resolves into
 * exactly one branch; a Place with no real resolved PostalAddress must never
 * ship (Google requires one for rich-result eligibility, and a placeholder
 * reads as spam/an error, not a courtesy).
 *
 * Pulled out of site/src/pages/s/[slug].astro into a plain function so the
 * decision logic is unit-testable (see event-jsonld.test.ts) independent of
 * Astro's component/build pipeline -- the .astro file only wires real props
 * into buildEventJsonLd() and renders the result.
 */
import {
  buildVenueIndex, resolveVenue, hasResolvedAddress, isVirtualVenue, toZonedISOString,
  type Facility,
} from './db';

export interface EventJsonLdStory {
  slug: string;
  title: string;
  body: string;
  source_type: string;
  occurs_at: string | null;
  ends_at?: string | null;
  venue_raw?: string | null;
  is_recurring_series?: boolean;
}

export interface EventJsonLdSite {
  cityName: string;
  stateAbbr: string;
  siteName: string;
  timezone: string;
}

/**
 * Returns the Event JSON-LD object to emit, or null if this story shouldn't
 * carry any Event markup at all (not an event, a recurring-series page, or
 * a venue that neither resolves to a real address nor reads as virtual).
 */
export function buildEventJsonLd(
  story: EventJsonLdStory,
  facilities: Facility[],
  site: EventJsonLdSite,
  canonicalUrl: string,
  heroUrl: string,
): Record<string, unknown> | null {
  const isEvent = story.source_type === 'event' && Boolean(story.occurs_at);
  if (!isEvent) return null;
  // A "series" story (ai_pipeline.publish.group_recurring_events) is ONE URL
  // standing in for MANY real-world occurrences -- Google's one-event-one-URL
  // rule means it can't honestly carry a single Event object, and this
  // codebase deliberately has no per-occurrence URL to hang one on instead
  // (that's the whole point of collapsing a recurring program into one page
  // -- see publish.py's moduldocstring on "scaled content"). Rather than
  // emit an eventSchedule/Schedule object built from loosely-formatted
  // display strings (series_dates is already human-formatted text, not
  // structured data), series pages skip Event JSON-LD entirely.
  if (story.is_recurring_series) return null;

  const venueIndex = buildVenueIndex(facilities);
  const resolvedVenue = resolveVenue(venueIndex, story.venue_raw);
  const venueResolved = hasResolvedAddress(resolvedVenue);
  const eventIsVirtual = isVirtualVenue(story.venue_raw, story.body);
  if (!venueResolved && !eventIsVirtual) return null;

  const startDate = toZonedISOString(story.occurs_at!, site.timezone);
  const endDate = story.ends_at ? toZonedISOString(story.ends_at, site.timezone) : undefined;

  const physicalLocation = venueResolved ? {
    '@type': 'Place',
    name: resolvedVenue!.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: resolvedVenue!.street_address,
      addressLocality: site.cityName,
      addressRegion: site.stateAbbr,
      postalCode: resolvedVenue!.postal_code,
      addressCountry: 'US',
    },
    ...(resolvedVenue!.lat != null && resolvedVenue!.lon != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: resolvedVenue!.lat, longitude: resolvedVenue!.lon } }
      : {}),
  } : null;
  const virtualLocation = eventIsVirtual ? { '@type': 'VirtualLocation', url: canonicalUrl } : null;

  const location = physicalLocation && virtualLocation
    ? [physicalLocation, virtualLocation]
    : (physicalLocation ?? virtualLocation);
  const eventAttendanceMode = physicalLocation && virtualLocation
    ? 'https://schema.org/MixedEventAttendanceMode'
    : virtualLocation
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode';

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: story.title,
    startDate,
    ...(endDate ? { endDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode,
    location,
    description: story.body.slice(0, 300),
    image: [heroUrl],
    // The resolved venue is the most defensible organizer we can state
    // without inventing a fact (a library/park/city-hall event is
    // reasonably organized by the place hosting it); a virtual-only event
    // with no resolved physical venue falls back to the site itself rather
    // than guess.
    organizer: { '@type': 'Organization', name: resolvedVenue?.name ?? site.siteName },
  };
}
