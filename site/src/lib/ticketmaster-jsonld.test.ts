import { describe, it, expect } from 'vitest';
import { buildTicketmasterEventJsonLd } from './ticketmaster-jsonld';
import type { TicketmasterFeedItem, TicketmasterEvent } from './ticketmaster';

function tmEvent(overrides: Partial<TicketmasterEvent> = {}): TicketmasterEvent {
  return {
    id: 'tm-1', title: 'A Touring Band Live in Sioux Falls', attractionId: null, venueId: null, venueName: null,
    venueLatitude: null, venueLongitude: null, venueAddress: null,
    venueCity: null, venueStateCode: null, venuePostalCode: null,
    venueDistanceMiles: null, ticketUrl: 'https://ticketmaster.com/event/tm-1',
    imageUrl: null, imageWidth: null, imageHeight: null,
    priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
    ...overrides,
  };
}

function tmItem(occurs_at: string | null, overrides: Partial<TicketmasterEvent> = {}): TicketmasterFeedItem {
  return { sourceKind: 'ticketmaster', occurs_at, ticketmasterEvent: tmEvent(overrides) };
}

const CANONICAL = 'https://brookingsview.com/whats-on/a-touring-band-live-in-sioux-falls/';

describe('buildTicketmasterEventJsonLd', () => {
  it('returns null when there is no date to anchor an Event on', () => {
    const item = tmItem(null);
    expect(buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View')).toBeNull();
  });

  it('builds a full Event object with real venue address/geo (Denny Sanford PREMIER Center, real captured shape)', () => {
    const item = tmItem('2026-12-13T01:30:00Z', {
      venueName: 'Denny Sanford PREMIER Center',
      venueAddress: '1201 N West Ave', venueCity: 'Sioux Falls', venueStateCode: 'SD', venuePostalCode: '57104',
      venueLatitude: 43.5581, venueLongitude: -96.7422,
      imageUrl: 'https://s1.ticketm.net/dam/real.jpg',
    });
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      '@id': CANONICAL,
      url: CANONICAL,
      name: 'A Touring Band Live in Sioux Falls',
      startDate: '2026-12-13T01:30:00Z',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: 'Denny Sanford PREMIER Center',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1201 N West Ave',
          addressLocality: 'Sioux Falls',
          addressRegion: 'SD',
          postalCode: '57104',
          addressCountry: 'US',
        },
        geo: { '@type': 'GeoCoordinates', latitude: 43.5581, longitude: -96.7422 },
      },
      image: ['https://s1.ticketm.net/dam/real.jpg'],
      organizer: { '@type': 'Organization', name: 'Denny Sanford PREMIER Center' },
    });
  });

  it('omits location entirely when address data is incomplete -- never ships a placeholder address', () => {
    const item = tmItem('2026-12-13T01:30:00Z', { venueName: 'Some Venue' }); // no address/city/state
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result?.location).toBeUndefined();
  });

  it('omits image when none was resolved', () => {
    const item = tmItem('2026-12-13T01:30:00Z');
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result?.image).toBeUndefined();
  });

  it('includes offers when a real price is known', () => {
    const item = tmItem('2026-12-13T01:30:00Z', { priceMin: 25, priceMax: 75, priceCurrency: 'USD' });
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result?.offers).toEqual({
      '@type': 'Offer',
      url: 'https://ticketmaster.com/event/tm-1',
      price: 25,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    });
  });

  it('omits offers when no price is known -- never fabricates a price', () => {
    const item = tmItem('2026-12-13T01:30:00Z');
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result?.offers).toBeUndefined();
  });

  it('falls back to the site name as organizer when even the venue name is unknown', () => {
    const item = tmItem('2026-12-13T01:30:00Z');
    const result = buildTicketmasterEventJsonLd(item, CANONICAL, 'Brookings View');
    expect(result?.organizer).toEqual({ '@type': 'Organization', name: 'Brookings View' });
  });
});
