import { describe, expect, it } from 'vitest';
import { offerField, organizerField, placeDescription } from './event-jsonld-fields';

describe('offerField (owner 2026-11-26: an offer needs the source on-sale date)', () => {
  // Real row: Broomfield /whats-on/ build 2026-11-26, Ticketmaster rZ7HnEZ1AfPwqd "Joe Torry" (min 5 USD, on sale 2026-06-04T14:00:00Z).
  const joe = { price: 5, currency: 'USD', validFrom: '2026-06-04T14:00:00Z', url: 'https://www.ticketweb.com/event/joe-torry-denver-improv-tickets/14972743' };
  it('price + currency + validFrom -> an Offer with validFrom', () => {
    expect(offerField(joe)).toMatchObject({ '@type': 'Offer', price: 5, priceCurrency: 'USD', validFrom: '2026-06-04T14:00:00Z' });
  });
  it('without the on-sale date, or without a price, no offer at all', () => {
    expect(offerField({ ...joe, validFrom: null })).toBeUndefined();
    expect(offerField({ ...joe, price: null })).toBeUndefined();
  });
});

describe('placeDescription', () => {
  it('Ticketmaster: name at venue, town added only when the venue does not say it', () => {
    // real rows, Broomfield build 2026-11-26
    expect(placeDescription('Chibs', 'Club Vinyl', 'Denver')).toBe('Chibs at Club Vinyl, Denver.');
    expect(placeDescription('Joe Torry', 'Denver Improv', 'Denver')).toBe('Joe Torry at Denver Improv.');
  });
  it('holiday rows (config/holiday-pages/gb/christmas-glasgow.ts)', () => {
    expect(placeDescription("Glasgow's Winter Wonderland, St Enoch Square", 'St Enoch Square', 'Glasgow')).toBeUndefined();
    expect(placeDescription('Hansel & Gretel (Hopscotch Theatre and Glasgow Life)', 'Community centres across Glasgow', 'Glasgow'))
      .toBe('Hansel & Gretel (Hopscotch Theatre and Glasgow Life), in community centres across Glasgow.');
  });
  it('no place, no description', () => {
    expect(placeDescription('Chibs', null)).toBeUndefined();
  });
});

describe('organizerField', () => {
  it('a named promoter; never the venue placeholder or "miscellaneous"', () => {
    expect(organizerField('LIVE NATION MUSIC')).toEqual({ '@type': 'Organization', name: 'LIVE NATION MUSIC' });
    expect(organizerField('PROMOTED BY VENUE')).toBeUndefined();
    expect(organizerField('MISCELLANEOUS PROMOTER')).toBeUndefined();
    expect(organizerField(null)).toBeUndefined();
  });
});
