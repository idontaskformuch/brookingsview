import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeTicketmasterEvent, fetchTicketmasterEvents, getTicketmasterEventsForTown, isSportsEvent,
  isNonEventListing, distanceLabel,
  type RawTicketmasterEvent,
} from './ticketmaster';
import { siteConfig } from './site-config';

/** Trimmed from a real Discovery API response, fetched live for a
 *  75-mile-radius Brookings search on 2026-09-07 (SDSU football vs. Murray
 *  State) -- field names and nesting are verbatim, most of the real
 *  ~10-entry `images` array and every field this adapter doesn't read are
 *  dropped for readability. `classifications` is real too -- confirmed
 *  live that every one of Brookings' own 14 in-city results (all 13 SDSU
 *  games and the one non-SDSU "MaskedMania Wrestling") carried
 *  segment.name === 'Sports'. Venue address/geo/distance are the real
 *  captured Dana J. Dykhouse Stadium object (3.57mi from the search
 *  origin -- Brookings' own coordinates, so genuinely "in town"). */
function realFixture(overrides: Partial<RawTicketmasterEvent> = {}): RawTicketmasterEvent {
  return {
    id: 'Z7r9jZ1A70S3p',
    name: 'South Dakota State Jackrabbits Football vs. Murray State Racers Football',
    url: 'https://www.ticketmaster.com/event/Z7r9jZ1A70S3p',
    images: [
      { url: 'https://s1.ticketm.net/dam/.../CUSTOM.jpg', width: 305, height: 225, ratio: '4_3' },
      { url: 'https://s1.ticketm.net/dam/.../TABLET_LANDSCAPE_LARGE_16_9.jpg', width: 2048, height: 1152, ratio: '16_9' },
      { url: 'https://s1.ticketm.net/dam/.../RETINA_LANDSCAPE_16_9.jpg', width: 1136, height: 639, ratio: '16_9' },
    ],
    dates: { start: { localDate: '2026-10-24', localTime: '14:00:00', dateTime: '2026-10-24T19:00:00Z' } },
    _embedded: {
      venues: [{
        id: 'Z7r9jZaeWt',
        name: 'Dana J. Dykhouse Stadium',
        address: { line1: '1396 Stadium Rd' },
        city: { name: 'Brookings' },
        state: { stateCode: 'SD' },
        postalCode: '57006',
        location: { latitude: '44.301399000', longitude: '-96.869202000' },
        distance: 3.57,
      }],
    },
    classifications: [{ primary: true, segment: { name: 'Sports' } }],
    ...overrides,
  };
}

describe('normalizeTicketmasterEvent', () => {
  it('maps a real captured event correctly', () => {
    const result = normalizeTicketmasterEvent(realFixture());
    expect(result).toEqual({
      sourceKind: 'ticketmaster',
      occurs_at: '2026-10-24T19:00:00Z',
      ticketmasterEvent: {
        id: 'Z7r9jZ1A70S3p',
        title: 'South Dakota State Jackrabbits Football vs. Murray State Racers Football',
        attractionId: null,
        venueId: 'Z7r9jZaeWt',
        venueName: 'Dana J. Dykhouse Stadium',
        venueLatitude: 44.301399,
        venueLongitude: -96.869202,
        venueAddress: '1396 Stadium Rd',
        venueCity: 'Brookings',
        venueStateCode: 'SD',
        venuePostalCode: '57006',
        venueDistanceMiles: 3.57,
        ticketUrl: 'https://www.ticketmaster.com/event/Z7r9jZ1A70S3p',
        imageUrl: 'https://s1.ticketm.net/dam/.../TABLET_LANDSCAPE_LARGE_16_9.jpg',
        imageWidth: 2048,
        imageHeight: 1152,
        priceRangeText: null,
        priceMin: null,
        priceMax: null,
        priceCurrency: null,
      },
    });
  });

  it('parses the real primary attraction id (What\'s On Phase 5 follow-up, "Tour-Run Collapsing" -- real captured value: 6 live Disney On Ice tour stops all shared this exact id)', () => {
    const result = normalizeTicketmasterEvent(realFixture({
      _embedded: {
        venues: [{ name: 'Denny Sanford PREMIER Center' }],
        attractions: [
          { id: 'K8vZ9172HM0', name: 'Disney On Ice presents Find Your Hero' },
          { id: 'K8vZ9171K80', name: 'Disney On Ice' },
        ],
      },
    }));
    expect(result.ticketmasterEvent.attractionId).toBe('K8vZ9172HM0');
  });

  it('handles no attractions at all -- confirmed live, real events can lack this field entirely', () => {
    const result = normalizeTicketmasterEvent(realFixture({ _embedded: { venues: [{ name: 'X' }] } }));
    expect(result.ticketmasterEvent.attractionId).toBeNull();
  });

  it('parses the real venue id (What\'s On Phase 5 follow-up: preferred over name for tier matching, since names can drift)', () => {
    const result = normalizeTicketmasterEvent(realFixture());
    expect(result.ticketmasterEvent.venueId).toBe('Z7r9jZaeWt');
  });

  it('parses real venue geo/address/distance fields', () => {
    const result = normalizeTicketmasterEvent(realFixture());
    const e = result.ticketmasterEvent;
    expect(e.venueLatitude).toBe(44.301399);
    expect(e.venueLongitude).toBe(-96.869202);
    expect(e.venueDistanceMiles).toBe(3.57);
    expect(e.venueAddress).toBe('1396 Stadium Rd');
    expect(e.venueCity).toBe('Brookings');
    expect(e.venueStateCode).toBe('SD');
    expect(e.venuePostalCode).toBe('57006');
  });

  it('handles missing venue geo/address/distance entirely -- never crashes, never guesses', () => {
    const result = normalizeTicketmasterEvent(realFixture({ _embedded: undefined }));
    const e = result.ticketmasterEvent;
    expect(e.venueId).toBeNull();
    expect(e.venueLatitude).toBeNull();
    expect(e.venueLongitude).toBeNull();
    expect(e.venueDistanceMiles).toBeNull();
    expect(e.venueAddress).toBeNull();
    expect(e.venueCity).toBeNull();
    expect(e.venueStateCode).toBeNull();
    expect(e.venuePostalCode).toBeNull();
  });

  it('handles a malformed (non-numeric) coordinate string without crashing', () => {
    const result = normalizeTicketmasterEvent(realFixture({
      _embedded: { venues: [{ name: 'X', location: { latitude: 'not-a-number', longitude: '-96.8' } }] },
    }));
    expect(result.ticketmasterEvent.venueLatitude).toBeNull();
    expect(result.ticketmasterEvent.venueLongitude).toBe(-96.8);
  });

  it('captures raw price min/max/currency alongside the formatted display text', () => {
    const result = normalizeTicketmasterEvent(realFixture({ priceRanges: [{ min: 25, max: 75, currency: 'USD' }] }));
    const e = result.ticketmasterEvent;
    expect(e.priceMin).toBe(25);
    expect(e.priceMax).toBe(75);
    expect(e.priceCurrency).toBe('USD');
    expect(e.priceRangeText).toBe('$25 - $75');
  });

  it('picks the widest image, not just the first in the array -- URL and dimensions together', () => {
    const result = normalizeTicketmasterEvent(realFixture());
    expect(result.ticketmasterEvent.imageUrl).toContain('TABLET_LANDSCAPE_LARGE_16_9');
    expect(result.ticketmasterEvent.imageWidth).toBe(2048);
    expect(result.ticketmasterEvent.imageHeight).toBe(1152);
  });

  it('handles a missing images array (no live-captured example had one, but Discovery API omits the key entirely for some listings)', () => {
    const result = normalizeTicketmasterEvent(realFixture({ images: undefined }));
    expect(result.ticketmasterEvent.imageUrl).toBeNull();
    expect(result.ticketmasterEvent.imageWidth).toBeNull();
    expect(result.ticketmasterEvent.imageHeight).toBeNull();
  });

  it('handles a missing venue (real live example: "MaskedMania Wrestling" carried a venue, but Discovery API can omit _embedded entirely)', () => {
    const result = normalizeTicketmasterEvent(realFixture({ _embedded: undefined }));
    expect(result.ticketmasterEvent.venueName).toBeNull();
  });

  it('handles a missing dates.start.dateTime (no live example lacked one, but the API schema allows date/time-TBD listings) -- never fabricates a time', () => {
    const result = normalizeTicketmasterEvent(realFixture({ dates: { start: { localDate: '2026-10-24' } } }));
    expect(result.occurs_at).toBeNull();
  });

  it('formats a price range when present (constructed -- none of the 14 live Brookings results had pricing set)', () => {
    const result = normalizeTicketmasterEvent(realFixture({ priceRanges: [{ min: 25, max: 75, currency: 'USD' }] }));
    expect(result.ticketmasterEvent.priceRangeText).toBe('$25 - $75');
  });

  it('formats a single-value price range without a dash', () => {
    const result = normalizeTicketmasterEvent(realFixture({ priceRanges: [{ min: 40, max: 40, currency: 'USD' }] }));
    expect(result.ticketmasterEvent.priceRangeText).toBe('$40');
  });

  it('returns null price range when absent (the real, common case)', () => {
    const result = normalizeTicketmasterEvent(realFixture({ priceRanges: undefined }));
    expect(result.ticketmasterEvent.priceRangeText).toBeNull();
  });
});

describe('fetchTicketmasterEvents error handling -- every path returns [], never throws', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns [] when TICKETMASTER_API_KEY is missing, without attempting a fetch', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] on a simulated rate-limit (429) response', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('returns [] on a simulated 5xx server error', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('returns [] on a simulated network failure', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('normalizes a real non-Sports result on a successful single-page response', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({
      id: 'concert-1',
      name: 'A Touring Band Live in Brookings',
      classifications: [{ primary: true, segment: { name: 'Music' } }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: { events: [musicEvent] },
        page: { totalPages: 1, number: 0 },
      }),
    }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toHaveLength(1);
    expect(result[0].ticketmasterEvent.title).toBe('A Touring Band Live in Brookings');
  });

  it('filters out a real Sports-classified event entirely -- the Athletics filter (prerequisite to Phase 4)', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        // realFixture()'s default classification IS Sports -- this is the
        // real captured shape for every one of Brookings' 14 live results.
        _embedded: { events: [realFixture()] },
        page: { totalPages: 1, number: 0 },
      }),
    }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('keeps non-Sports events and drops Sports events from the same mixed response', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({
      id: 'concert-1',
      name: 'A Touring Band Live in Brookings',
      classifications: [{ primary: true, segment: { name: 'Music' } }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: { events: [realFixture(), musicEvent] },
        page: { totalPages: 1, number: 0 },
      }),
    }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toHaveLength(1);
    expect(result[0].ticketmasterEvent.id).toBe('concert-1');
  });

  it('filters out a real "Premium Perch Add-On" listing entirely -- the Ticket-Type filter (What\'s On Phase 5 follow-up)', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const addon = realFixture({
      id: 'addon-1',
      name: 'Premium Perch Add-On: Jonas Brothers: 5:00 PM',
      classifications: [{ primary: true, segment: { name: 'Miscellaneous' }, type: { name: 'Upsell' } }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: { events: [addon] },
        page: { totalPages: 1, number: 0 },
      }),
    }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('keeps a real event and drops an add-on listing from the same mixed response', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({
      id: 'concert-1',
      name: 'Jonas Brothers: The Burning Up Tour All Over Again',
      classifications: [{ primary: true, segment: { name: 'Music' }, type: { name: 'Undefined' } }],
    });
    const addon = realFixture({
      id: 'addon-1',
      name: 'Premium Perch Add-On: Jonas Brothers: 5:00 PM',
      classifications: [{ primary: true, segment: { name: 'Miscellaneous' }, type: { name: 'Upsell' } }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: { events: [musicEvent, addon] },
        page: { totalPages: 1, number: 0 },
      }),
    }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toHaveLength(1);
    expect(result[0].ticketmasterEvent.id).toBe('concert-1');
  });
});

describe('isSportsEvent', () => {
  it('is true for a real captured Sports-classified event', () => {
    expect(isSportsEvent(realFixture())).toBe(true);
  });

  it('is false for a non-Sports segment', () => {
    expect(isSportsEvent(realFixture({ classifications: [{ primary: true, segment: { name: 'Music' } }] }))).toBe(false);
    expect(isSportsEvent(realFixture({ classifications: [{ primary: true, segment: { name: 'Arts & Theatre' } }] }))).toBe(false);
  });

  it('falls back to the first classification when none is marked primary', () => {
    expect(isSportsEvent(realFixture({ classifications: [{ segment: { name: 'Sports' } }] }))).toBe(true);
  });

  it('is false (never excluded) when classifications are entirely absent -- not enough signal to guess', () => {
    expect(isSportsEvent(realFixture({ classifications: undefined }))).toBe(false);
  });

  it('is false when classifications is an empty array', () => {
    expect(isSportsEvent(realFixture({ classifications: [] }))).toBe(false);
  });
});

describe('isNonEventListing (What\'s On Phase 5 follow-up, "Ticket-Type Filtering")', () => {
  it('is true for a real captured "Premium Perch Add-On" listing (Upsell type)', () => {
    expect(isNonEventListing(realFixture({
      name: 'Premium Perch Add-On: Jonas Brothers: 5:00 PM',
      classifications: [{
        primary: true,
        segment: { name: 'Miscellaneous' },
        type: { name: 'Upsell' },
      }],
    }))).toBe(true);
  });

  it('is false for a real event (Undefined type, the common real-data case)', () => {
    expect(isNonEventListing(realFixture({
      classifications: [{ primary: true, segment: { name: 'Music' }, type: { name: 'Undefined' } }],
    }))).toBe(false);
  });

  it('is false when type is entirely absent -- confirmed live, most real events have no type field at all', () => {
    expect(isNonEventListing(realFixture({ classifications: [{ primary: true, segment: { name: 'Music' } }] }))).toBe(false);
  });

  it('does not falsely exclude an event just because its NAME resembles an add-on -- this is a structural check, not a name match', () => {
    expect(isNonEventListing(realFixture({
      name: 'The Add-Ons Live Tour',
      classifications: [{ primary: true, segment: { name: 'Music' }, type: { name: 'Undefined' } }],
    }))).toBe(false);
  });

  it('falls back to the first classification when none is marked primary', () => {
    expect(isNonEventListing(realFixture({ classifications: [{ type: { name: 'Upsell' } }] }))).toBe(true);
  });

  it('is false (never excluded) when classifications are entirely absent -- not enough signal to guess', () => {
    expect(isNonEventListing(realFixture({ classifications: undefined }))).toBe(false);
  });
});

describe('getTicketmasterEventsForTown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns [] and makes no network call when ticketmaster.enabled is false', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await getTicketmasterEventsForTown({
      ticketmaster: { enabled: false, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 },
    });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] and makes no network call when ticketmaster config is entirely absent', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await getTicketmasterEventsForTown({});
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is genuinely inert against the REAL production Brookings config (site-config.ts), not just a synthetic test object', async () => {
    expect(siteConfig.townId).toBe('brookings_sd');
    expect(siteConfig.ticketmaster).toEqual({ enabled: false, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await getTicketmasterEventsForTown(siteConfig);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('when enabled, passes the real coordinates/radius through to fetchTicketmasterEvents unchanged', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await getTicketmasterEventsForTown({
      ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 },
    });
    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('latlong')).toBe('44.3114,-96.7984');
    expect(calledUrl.searchParams.get('radius')).toBe('75');
  });
});

describe('fetchTicketmasterEvents query construction (What\'s On Phase 3 follow-up: Radius Fix)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('queries with latlong/radius/unit=miles, NOT city/stateCode -- the exact-city-tag match that structurally excluded Sioux Falls', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('latlong')).toBe('44.3114,-96.7984');
    expect(calledUrl.searchParams.get('radius')).toBe('75');
    expect(calledUrl.searchParams.get('unit')).toBe('miles');
    expect(calledUrl.searchParams.has('city')).toBe(false);
    expect(calledUrl.searchParams.has('stateCode')).toBe(false);
  });
});

describe('distanceLabel (What\'s On Phase 5: anti-doorway-pattern transparency)', () => {
  it('reads as "In <city>" for a real Brookings-proper venue (3.57mi -- Dana J. Dykhouse Stadium), never a nonsensical small number', () => {
    expect(distanceLabel(3.57, 'Brookings')).toBe('In Brookings');
  });

  it('reads as "In <city>" for a venue Discovery API places almost exactly at the search origin', () => {
    expect(distanceLabel(0.02, 'Brookings')).toBe('In Brookings');
  });

  it('shows a real rounded mileage for a genuinely regional venue (50.06mi -- Washington Pavilion, Sioux Falls)', () => {
    expect(distanceLabel(50.06, 'Brookings')).toBe('~50 miles away');
  });

  it('returns null (no label) when distance is unknown -- never fabricates "nearby"', () => {
    expect(distanceLabel(null, 'Brookings')).toBeNull();
  });

  it('rounds to the nearest whole mile', () => {
    expect(distanceLabel(48.6, 'Brookings')).toBe('~49 miles away');
    expect(distanceLabel(48.4, 'Brookings')).toBe('~48 miles away');
  });
});
