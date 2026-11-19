import { describe, it, expect } from 'vitest';
import { buildTicketmasterEventJsonLd, buildTicketmasterListJsonLd } from './ticketmaster-jsonld';
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

// The /whats-on/ listing: since SPEC Fas 13a the events' markup lives there (no detail page).
const CANONICAL = 'https://brookingsview.com/whats-on/';

describe('performer (Search Console, owner 2026-11-18: only from the source)', () => {
  // Real row: Brookings /whats-on/ build 2026-11-19, Ticketmaster Z7r9jZ1A7q3eb "Casey Donahew" at The District, Sioux Falls.
  const casey = (overrides: Partial<TicketmasterEvent> = {}) => tmItem('2026-11-21T02:00:00Z', {
    id: 'Z7r9jZ1A7q3eb', title: 'Casey Donahew', ticketUrl: 'https://www.ticketmaster.com/event/Z7r9jZ1A7q3eb',
    segment: 'Music', attractionNames: ['Casey Donahew'], ...overrides,
  });

  it('a music event names its attraction as performer', () => {
    expect(buildTicketmasterEventJsonLd(casey(), CANONICAL)!.performer).toEqual({ '@type': 'PerformingGroup', name: 'Casey Donahew' });
  });

  it('the same row as theatre (segment the only changed field) gets none: there the attraction is the production', () => {
    expect(buildTicketmasterEventJsonLd(casey({ segment: 'Arts & Theatre' }), CANONICAL)!.performer).toBeUndefined();
  });

  it('the same row without attractions (attractionNames the only changed field) gets none, never the title', () => {
    expect(buildTicketmasterEventJsonLd(casey({ attractionNames: [] }), CANONICAL)!.performer).toBeUndefined();
  });
});

describe('buildTicketmasterEventJsonLd', () => {
  it('returns null when there is no date to anchor an Event on', () => {
    const item = tmItem(null);
    expect(buildTicketmasterEventJsonLd(item, CANONICAL)).toBeNull();
  });

  it('builds a full Event object with real venue address/geo (Denny Sanford PREMIER Center, real captured shape)', () => {
    const item = tmItem('2026-12-13T01:30:00Z', {
      venueName: 'Denny Sanford PREMIER Center',
      venueAddress: '1201 N West Ave', venueCity: 'Sioux Falls', venueStateCode: 'SD', venuePostalCode: '57104',
      venueLatitude: 43.5581, venueLongitude: -96.7422,
      imageUrl: 'https://s1.ticketm.net/dam/real.jpg',
    });
    const result = buildTicketmasterEventJsonLd(item, CANONICAL);
    expect(result).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      '@id': `${CANONICAL}#tm-tm-1`,
      url: 'https://ticketmaster.com/event/tm-1',
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
    });
  });

  it('omits location entirely when address data is incomplete -- never ships a placeholder address', () => {
    const item = tmItem('2026-12-13T01:30:00Z', { venueName: 'Some Venue' }); // no address/city/state
    const result = buildTicketmasterEventJsonLd(item, CANONICAL);
    expect(result?.location).toBeUndefined();
  });

  it('omits image when none was resolved', () => {
    const item = tmItem('2026-12-13T01:30:00Z');
    const result = buildTicketmasterEventJsonLd(item, CANONICAL);
    expect(result?.image).toBeUndefined();
  });

  it('includes offers when a real price is known', () => {
    const item = tmItem('2026-12-13T01:30:00Z', { priceMin: 25, priceMax: 75, priceCurrency: 'USD' });
    const result = buildTicketmasterEventJsonLd(item, CANONICAL);
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
    const result = buildTicketmasterEventJsonLd(item, CANONICAL);
    expect(result?.offers).toBeUndefined();
  });

  it('has no organizer: Discovery names none, and the venue is not the organiser (owner 2026-11-16)', () => {
    const item = tmItem('2026-12-13T01:30:00Z', { venueName: 'Denny Sanford PREMIER Center' });
    expect(buildTicketmasterEventJsonLd(item, CANONICAL)).not.toHaveProperty('organizer');
  });

  it('keeps addressCountry US for a US venue and does not require a state for a GB one', () => {
    const us = buildTicketmasterEventJsonLd(tmItem('2026-12-13T01:30:00Z', {
      venueName: 'Denny Sanford PREMIER Center', venueAddress: '1201 N West Ave', venueCity: 'Sioux Falls',
      venueStateCode: 'SD', venuePostalCode: '57104',
    }), CANONICAL);
    expect((us?.location as any).address.addressCountry).toBe('US');

    // Real Discovery shape for Celtic Park, Glasgow: state is null, country GB
    const gb = buildTicketmasterEventJsonLd(tmItem('2026-10-22T19:00:00Z', {
      venueName: 'Celtic Park', venueAddress: '18 Kerrydale Street', venueCity: 'Glasgow',
      venueStateCode: null, venueCountryCode: 'GB', venuePostalCode: 'G40 3RE',
    }), CANONICAL);
    expect((gb?.location as any).address).toMatchObject({
      streetAddress: '18 Kerrydale Street', addressLocality: 'Glasgow', postalCode: 'G40 3RE', addressCountry: 'GB',
    });
    expect((gb?.location as any).address.addressRegion).toBeUndefined();
  });

  it('still omits location for a US venue without a state (unchanged behaviour)', () => {
    const r = buildTicketmasterEventJsonLd(tmItem('2026-12-13T01:30:00Z', {
      venueName: 'X', venueAddress: '1 Main', venueCity: 'Town', venueStateCode: null, venuePostalCode: '57104',
    }), CANONICAL);
    expect(r?.location).toBeUndefined();
  });
});

describe('buildTicketmasterListJsonLd (SPEC Fas 13a)', () => {
  // Two real rows, field for field as the 2026-11-16 builds printed them on /whats-on/ (Discovery fields not in the markup left null).
  // Glasgow: Shinedown at OVO Hydro, Ticketmaster id 1AdbZ_7GkslloZ0.
  const shinedown = tmItem('2026-11-16T18:30:00Z', {
    id: '1AdbZ_7GkslloZ0', title: 'Shinedown: Dance, Kid, Dance Act II', venueName: 'OVO Hydro',
    venueAddress: 'Exhibition Way', venueCity: 'Glasgow', venueStateCode: null, venueCountryCode: 'GB', venuePostalCode: 'G3 8YW',
    venueLatitude: 55.86087, venueLongitude: -4.288154,
    ticketUrl: 'https://www.ticketmaster.co.uk/shinedown-dance-kid-dance-act-ii-glasgow-16-11-2026/event/3600644C6BAD1024',
    imageUrl: 'https://s1.ticketm.net/dam/a/9f7/ed689da7-8216-4ecc-bc2d-8284c69e99f7_SOURCE',
  });
  // Broomfield: Shimmy Shakin' Blues at La Rumba, Denver, Ticketmaster id rZ7HnEZ1A4Za-N.
  const shimmy = tmItem('2026-11-19T02:00:00Z', {
    id: 'rZ7HnEZ1A4Za-N', title: "Shimmy Shakin' Blues", venueName: 'La Rumba',
    venueAddress: '99 W 9th Ave', venueCity: 'Denver', venueStateCode: 'CO', venueCountryCode: 'US', venuePostalCode: '80204',
    venueLatitude: 39.73059, venueLongitude: -104.98857,
    ticketUrl: 'https://www.ticketweb.com/event/shimmy-shakin-blues-la-rumba-tickets/15009863',
    imageUrl: 'https://i.ticketweb.com/i/00/13/61/18/83_Edp.jpg?v=4', priceMin: 20.03, priceCurrency: 'USD',
  });
  const NOW = new Date('2026-11-16T12:00:00Z');

  it('lists the dated events in page order as one ItemList, each Event without its own @context', () => {
    const r = buildTicketmasterListJsonLd([shinedown, tmItem(null), shimmy], CANONICAL, NOW) as any;
    expect(r).toMatchObject({ '@context': 'https://schema.org', '@type': 'ItemList', url: CANONICAL, numberOfItems: 2 });
    expect(r.itemListElement.map((x: any) => [x.position, x.item['@id'], x.item.url])).toEqual([
      [1, `${CANONICAL}#tm-1AdbZ_7GkslloZ0`, 'https://www.ticketmaster.co.uk/shinedown-dance-kid-dance-act-ii-glasgow-16-11-2026/event/3600644C6BAD1024'],
      [2, `${CANONICAL}#tm-rZ7HnEZ1A4Za-N`, 'https://www.ticketweb.com/event/shimmy-shakin-blues-la-rumba-tickets/15009863'],
    ]);
    expect(r.itemListElement[0].item['@context']).toBeUndefined();
    expect(r.itemListElement[1].item.offers).toMatchObject({ price: 20.03, priceCurrency: 'USD' });
  });

  it('covers the next 14 days only (owner 2026-11-16: the full list added 210-290 kB)', () => {
    // The real Shimmy row with ONE field changed: occurs_at moved past the 14-day edge.
    const later = { ...shimmy, occurs_at: '2026-11-30T12:00:01Z' };
    const r = buildTicketmasterListJsonLd([shinedown, later], CANONICAL, NOW) as any;
    expect(r.itemListElement.map((x: any) => x.item.name)).toEqual(['Shinedown: Dance, Kid, Dance Act II']);
    expect(buildTicketmasterListJsonLd([later], CANONICAL, NOW)).toBeNull();
  });

  it('is null when nothing has a date, and an event without a ticket URL points at the listing', () => {
    expect(buildTicketmasterListJsonLd([tmItem(null)], CANONICAL, NOW)).toBeNull();
    // The real Shinedown row with ONE field changed: no ticket URL.
    const r = buildTicketmasterEventJsonLd({ ...shinedown, ticketmasterEvent: { ...shinedown.ticketmasterEvent, ticketUrl: '' } }, CANONICAL);
    expect(r?.url).toBe(CANONICAL);
  });
});
