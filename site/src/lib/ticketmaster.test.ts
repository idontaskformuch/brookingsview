import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeTicketmasterEvent, cleanTicketmasterTitle, fetchTicketmasterEvents, getTicketmasterEventsForTown, isSportsEvent,
  isNonEventListing, isUpgradeProductTitle, distanceLabel, _resetTicketmasterCacheForTests, _resetTicketmasterLimiterForTests,
  MAX_REQUESTS_PER_SECOND, DAILY_CALL_LIMIT,
  type RawTicketmasterEvent,
} from './ticketmaster';
import { siteConfig } from './site-config';

// The limiter spaces real requests 556 ms apart; every test but the limiter's own runs with no spacing so the suite stays fast.
beforeEach(() => _resetTicketmasterLimiterForTests({ paceMs: 0 }));

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
        venueCountryCode: null,
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
        segment: 'Sports',
        genre: null,
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
    expect(e.venueCountryCode).toBeNull();
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

  it('a missing key logs a ::warning:: (What\'s On production fix) -- a real GitHub Actions annotation, not just a line buried in the build log, distinguishing "the key never arrived" from "no events in the area"', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('::warning::'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TICKETMASTER_API_KEY not set'));
    warnSpy.mockRestore();
  });

  it('returns [] on a simulated rate-limit (429) response that persists through the retry', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it('a persistent 429 logs TWO distinct ::warning:: lines -- the 2026-09-08 production incident (What\'s On production fix) was specifically that this failure mode was silent, indistinguishable from "no events in the area"', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    const warningCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('::warning::'));
    expect(warningCalls).toHaveLength(2); // "retrying once" + "still rate-limited after one retry"
    expect(warningCalls[0][0]).toContain('rate-limited');
    expect(warningCalls[1][0]).toContain('still rate-limited');
    warnSpy.mockRestore();
  });

  it('a 429 that succeeds on retry returns real events and logs only the retry warning, not a failure', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({ id: 'concert-1', classifications: [{ primary: true, segment: { name: 'Music' } }] });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ _embedded: { events: [musicEvent] }, page: { totalPages: 1, number: 0 } }),
      });
    vi.stubGlobal('fetch', fetchSpy);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toHaveLength(1);
    const warningCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('::warning::'));
    expect(warningCalls).toHaveLength(1); // only the "retrying once" line -- no failure line, since it recovered
    warnSpy.mockRestore();
  });

  it('returns [] on a simulated 5xx server error and logs a ::warning::', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('::warning::'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    warnSpy.mockRestore();
  });

  it('logs the response body snippet on an HTTP error, when one is available', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => '{"fault":{"faultstring":"real Discovery API error body"}}',
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('real Discovery API error body'));
    warnSpy.mockRestore();
  });

  it('never throws even when the error response has no .text() method at all (a non-standard Response-like object)', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 })); // no .text at all
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
  });

  it.each([401, 403])('an HTTP %i (auth error) logs a ::warning:: -- the key was sent but Discovery API rejected it, a different silent failure mode than a missing key', async (status) => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text: async () => '' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('::warning::'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('auth error'));
    warnSpy.mockRestore();
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

  it('a successful fetch with real events logs a plain (non-::warning::) outcome line stating the count -- What\'s On production fix: every fetch must produce an outcome line, not just failures', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({ id: 'concert-1', classifications: [{ primary: true, segment: { name: 'Music' } }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { events: [musicEvent] }, page: { totalPages: 1, number: 0 } }),
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fetched 1 event(s)'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('::warning::'));
    logSpy.mockRestore();
  });

  it('a successful fetch with zero events in the radius (a legitimate, unremarkable state) still logs a plain outcome line, distinct from a failure', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchTicketmasterEvents(44.3114, -96.7984, 75);
    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fetched 0 event(s)'));
    expect(warnSpy).not.toHaveBeenCalled(); // zero events in a real, successful response is not a problem
    logSpy.mockRestore();
    warnSpy.mockRestore();
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
    // getTicketmasterEventsForTown() now memoizes by (lat,lon,radius) for
    // the lifetime of one build process (What's On production fix, three
    // redundant call sites -> one shared fetch) -- without clearing this
    // between tests, a later test using the SAME real Brookings coordinates
    // would silently receive an earlier test's mocked result instead of
    // exercising its own fetch mock.
    _resetTicketmasterCacheForTests();
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

  it('is genuinely enabled against the REAL production Brookings config (site-config.ts) as of Phase 7, not just a synthetic test object', async () => {
    expect(siteConfig.townId).toBe('brookings_sd');
    expect(siteConfig.ticketmaster).toEqual({ enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75, marqueeSize: 6 });
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await getTicketmasterEventsForTown(siteConfig);
    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('latlong')).toBe('44.3114,-96.7984');
    expect(calledUrl.searchParams.get('radius')).toBe('75');
  });

  it('one shared fetch serves both: sport only when the caller asks for it (evening layer), never in the What is On list or Today', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const musicEvent = realFixture({ id: 'concert-1', name: 'A Touring Band', classifications: [{ primary: true, segment: { name: 'Music' } }] });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ _embedded: { events: [realFixture(), musicEvent] }, page: { totalPages: 1, number: 0 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const cfg = { ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 } };
    const noSport = await getTicketmasterEventsForTown(cfg);
    const withSport = await getTicketmasterEventsForTown(cfg, { includeSports: true });
    expect(noSport.map((i) => i.ticketmasterEvent.id)).toEqual(['concert-1']);
    expect(withSport).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

  describe('memoization (What\'s On production fix -- three real call sites per build, previously three independent uncoordinated fetches)', () => {
    it('a second call with the SAME coordinates/radius does not fetch again -- shares the first call\'s result', async () => {
      vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
      const musicEvent = realFixture({ id: 'concert-1', classifications: [{ primary: true, segment: { name: 'Music' } }] });
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ _embedded: { events: [musicEvent] }, page: { totalPages: 1, number: 0 } }),
      });
      vi.stubGlobal('fetch', fetchSpy);
      const cfg = { ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 } };

      const first = await getTicketmasterEventsForTown(cfg);
      const second = await getTicketmasterEventsForTown(cfg);
      const third = await getTicketmasterEventsForTown(cfg); // the real three call sites: index.astro, [slug].astro, cityStatus.ts

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(first).toHaveLength(1);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it('two concurrent calls (arriving before the first resolves) still share ONE real fetch, not two', async () => {
      vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
      });
      vi.stubGlobal('fetch', fetchSpy);
      const cfg = { ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 } };

      // Not awaited individually -- both fire before either has a chance
      // to resolve, the real shape of three near-simultaneous page renders.
      const [a, b] = await Promise.all([getTicketmasterEventsForTown(cfg), getTicketmasterEventsForTown(cfg)]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it('a DIFFERENT radius for the same coordinates is treated as a real, separate fetch -- not merged with an unrelated cached result', async () => {
      vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 1, number: 0 } }),
      });
      vi.stubGlobal('fetch', fetchSpy);
      await getTicketmasterEventsForTown({ ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 } });
      await getTicketmasterEventsForTown({ ticketmaster: { enabled: true, latitude: 44.3114, longitude: -96.7984, radiusMiles: 35 } });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
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

describe('isUpgradeProductTitle: seating and hospitality upgrades are not events (owner 2026-10-23)', () => {
  it('filters the products seen live on /whats-on/', () => {
    for (const t of ['Club Level Seating: The Smashing Pumpkins', 'Club Level Seating: Hilary Duff', 'VIP Package - Dan + Shay', 'Premium Seating: Journey',
      'Parking: Gracie Abrams', 'Meet & Greet Package: Teddy Swims', 'Suite: Denver Nuggets', 'Hospitality Package: Kenny Chesney',
      // Glasgow, OVO Hydro (2026-10-28): 90 of 1 200 listings in 15 miles are "Venue Premium - <show>" hospitality products
      "Venue Premium - The Waterboys - Fisherman's Blues Revue", 'Venue Premium - Kevin Bridges:  Here If You Need Me', 'N-Dubz Official Vip Ticket Experiences']) {
      expect(isUpgradeProductTitle(t), t).toBe(true);
    }
  });
  it('keeps real shows, including ones whose name merely contains a product word', () => {
    for (const t of ['The Smashing Pumpkins: The Rats In A Cage Tour', 'Suite Life Live', 'Parking Lot Party Tour', 'VIPs of Comedy', 'Club Night with DJ Kai',
      'Disney On Ice presents Find Your Hero', 'Meet Me in St. Louis', 'Venue Premium Nights', 'The VIP Experiences of Glasgow Tour']) {
      expect(isUpgradeProductTitle(t), t).toBe(false);
    }
  });
  it('isNonEventListing sees the title even when the classification is an ordinary one', () => {
    expect(isNonEventListing({ id: '1', name: 'Club Level Seating: Hilary Duff', classifications: [{ primary: true, type: { name: 'Music' } }] } as never)).toBe(true);
    expect(isNonEventListing({ id: '2', name: 'Hilary Duff', classifications: [{ primary: true, type: { name: 'Music' } }] } as never)).toBe(false);
  });
});

describe('cleanTicketmasterTitle', () => {
  it('repairs a lost apostrophe', () => expect(cleanTicketmasterTitle('Disney Tim Burton???s The Nightmare Before Christmas')).toBe('Disney Tim Burton’s The Nightmare Before Christmas'));
});

describe('Ticketmaster placeholders and tours (owner 2026-10-29)', () => {
  const base = { id: 'x', name: 'A Show', dates: { start: { dateTime: '2026-11-01T20:00:00Z' } } } as RawTicketmasterEvent;
  it('a fallback picture is never used; a real one is', () => {
    const only = normalizeTicketmasterEvent({ ...base, images: [{ url: 'https://x/f.jpg', width: 2000, height: 1000, fallback: true }] });
    expect(only.ticketmasterEvent.imageUrl).toBeNull();
    const mixed = normalizeTicketmasterEvent({ ...base, images: [{ url: 'https://x/f.jpg', width: 2000, height: 1000, fallback: true }, { url: 'https://x/r.jpg', width: 640, height: 360, fallback: false }] });
    expect(mixed.ticketmasterEvent.imageUrl).toBe('https://x/r.jpg');
  });
  it('building tours are not events; an artist tour is', () => {
    expect(isNonEventListing({ ...base, name: 'KSE Venue Ball Arena Tours' })).toBe(true);
    expect(isNonEventListing({ ...base, name: 'Teddy Swims: The UGLY Tour' })).toBe(false);
    expect(isNonEventListing({ ...base, name: 'Taylor Swift | The Eras Tour' })).toBe(false);
  });
  it('cleanTicketmasterTitle leaves unknown patterns untouched', () => {
    expect(cleanTicketmasterTitle('D??a de Muertos Festival / Day of the Dead')).toBe('D??a de Muertos Festival / Day of the Dead');
    expect(cleanTicketmasterTitle('Caf?? Tacvba')).toBe('Caf?? Tacvba');
  });
});

describe('Discovery API pacing and daily call limit (owner 2026-11-08: max 1.8 requests/s, stop at 4500 calls/day)', () => {
  const ok = (totalPages: number, headers?: Record<string, string>) => ({
    ok: true, status: 200, json: async () => ({ _embedded: { events: [] }, page: { totalPages } }),
    headers: { get: (n: string) => headers?.[n.toLowerCase()] ?? null },
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('the agreed numbers', () => {
    expect(MAX_REQUESTS_PER_SECOND).toBe(1.8);
    expect(DAILY_CALL_LIMIT).toBe(4500);
  });

  it('no comment or constant still claims a 5 requests/second ceiling', () => {
    const src = readFileSync(join(__dirname, 'ticketmaster.ts'), 'utf8');
    expect(src).not.toMatch(/\b5\s*(req|requests)\w*\s*\/\s*sec|5\/sec|4 req\/sec/i);
  });

  it('spaces consecutive requests at least 1000/1.8 ms apart', async () => {
    vi.useFakeTimers();
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    _resetTicketmasterLimiterForTests(); // the real spacing
    const times: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { times.push(Date.now()); return ok(4); }));
    const run = fetchTicketmasterEvents(55.8, -4.2, 15);
    await vi.advanceTimersByTimeAsync(5000);
    await run;
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(Math.ceil(1000 / 1.8));
    expect(1000 / (times[3] - times[0]) * 3).toBeLessThanOrEqual(1.8);
  });

  it('two fetches running at the same time still share one limiter (no burst)', async () => {
    vi.useFakeTimers();
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    _resetTicketmasterLimiterForTests();
    const times: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { times.push(Date.now()); return ok(1); }));
    const both = Promise.all([fetchTicketmasterEvents(55.8, -4.2, 15), fetchTicketmasterEvents(39.9, -105.0, 20)]);
    await vi.advanceTimersByTimeAsync(3000);
    await both;
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(556);
  });

  it('makes no request once this build has used the daily limit, warns, and returns what it has', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    _resetTicketmasterLimiterForTests({ paceMs: 0, processCalls: DAILY_CALL_LIMIT });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fetchTicketmasterEvents(55.8, -4.2, 15)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('daily call limit (4500)'))).toBe(true);
  });

  it('call number 4500 is still made, number 4501 is not', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    _resetTicketmasterLimiterForTests({ paceMs: 0, processCalls: DAILY_CALL_LIMIT - 1 });
    const fetchSpy = vi.fn(async () => ok(3));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchTicketmasterEvents(55.8, -4.2, 15); // wants 3 pages, gets the 4500th call only
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("the API's own Rate-Limit headers count calls from every build: 4500 used today stops, 4499 does not", async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const run = async (available: string) => {
      _resetTicketmasterLimiterForTests({ paceMs: 0 });
      const fetchSpy = vi.fn(async () => ok(3, { 'rate-limit': '5000', 'rate-limit-available': available }));
      vi.stubGlobal('fetch', fetchSpy);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await fetchTicketmasterEvents(55.8, -4.2, 15);
      return fetchSpy.mock.calls.length;
    };
    expect(await run('500')).toBe(1); // 4500 used after page 0 -> page 1 is refused
    expect(await run('501')).toBe(3); // 4499 used -> all three pages
  });

  it('a response without rate-limit headers (as in every other test) does not disturb anything', async () => {
    vi.stubEnv('TICKETMASTER_API_KEY', 'fake-key-for-test');
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ _embedded: { events: [] }, page: { totalPages: 2 } }) }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchTicketmasterEvents(55.8, -4.2, 15);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
