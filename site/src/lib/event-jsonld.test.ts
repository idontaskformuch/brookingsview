import { describe, expect, it } from 'vitest';
import { buildEventJsonLd, type EventJsonLdStory } from './event-jsonld';
import type { Facility } from './db';

const SITE = {
  cityName: 'Moreno Valley',
  stateAbbr: 'CA',
  siteName: 'Moreno Valley View',
  timezone: 'America/Los_Angeles',
};

const MAIN_LIBRARY: Facility = {
  id: 4,
  slug: 'main-library',
  name: 'Moreno Valley Public Library — Main Branch',
  category: 'library',
  address: '25480 Alessandro Blvd, Moreno Valley, CA 92553',
  phone: null,
  website: null,
  hours_text: null,
  description: null,
  source_url: null,
  verified_date: null,
  aliases: ['Main Library'],
  street_address: '25480 Alessandro Blvd',
  postal_code: '92553',
  lat: null,
  lon: null,
  image_path: null,
  image_alt: null,
  name_aliases: [],
  image_attribution_text: null,
  image_attribution_url: null,
  image_needs_review: false,
  hours_structured: null,
  hours_needs_review: false,
  is_free: null,
  fee_note: null,
  accessibility_note: null,
  services: null,
  verification_method: null,
  hours_confidence: null,
};

const CITY_HALL_UNVERIFIED_ADDRESS: Facility = {
  ...MAIN_LIBRARY,
  slug: 'city-hall',
  name: 'Moreno Valley City Hall',
  aliases: ['City Hall'],
  street_address: null,
  postal_code: null,
};

function baseStory(overrides: Partial<EventJsonLdStory>): EventJsonLdStory {
  return {
    slug: 'event-1',
    title: 'Story Time',
    body: 'Weekly story time for kids ages 2-5.',
    source_type: 'event',
    occurs_at: '2026-09-08T18:00:00.000Z',
    ends_at: '2026-09-08T19:00:00.000Z',
    venue_raw: null,
    is_recurring_series: false,
    ...overrides,
  };
}

const CANONICAL_URL = 'https://morenovalleyview.com/s/event-1/';
const HERO_URL = 'https://morenovalleyview.com/og/event-1.png';

describe('buildEventJsonLd -- resolvable physical event', () => {
  const story = baseStory({
    venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
  });
  const result = buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL);

  it('emits a full Event object', () => {
    expect(result).not.toBeNull();
    expect(result!['@type']).toBe('Event');
    expect(result!['@id']).toBe(CANONICAL_URL);
    expect(result!.name).toBe('Story Time');
  });

  it('emits a Place with a real, resolved PostalAddress', () => {
    const location = result!.location as Record<string, unknown>;
    expect(location['@type']).toBe('Place');
    expect(location.name).toBe(MAIN_LIBRARY.name);
    const address = location.address as Record<string, unknown>;
    expect(address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '25480 Alessandro Blvd',
      addressLocality: 'Moreno Valley',
      addressRegion: 'CA',
      postalCode: '92553',
      addressCountry: 'US',
    });
  });

  it('carries an explicit America/Los_Angeles offset on startDate/endDate, never Z/UTC', () => {
    expect(result!.startDate).toBe('2026-09-08T11:00:00-07:00');
    expect(result!.endDate).toBe('2026-09-08T12:00:00-07:00');
  });

  it('is offline attendance mode and attributes the venue as organizer', () => {
    expect(result!.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect((result!.organizer as Record<string, unknown>).name).toBe(MAIN_LIBRARY.name);
  });
});

// Search Console 2026-11-28 (Broomfield, Moreno Valley): "Missing field 'url' (in 'organizer')". The url is the organizer's own website
// when the row has one, else our page about the venue, else (the site organizes) the site itself. Never a guessed address.
describe('buildEventJsonLd -- organizer.url', () => {
  const story = baseStory({ venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA' });
  const org = (r: Record<string, unknown> | null) => r!.organizer as Record<string, unknown>;
  it("is the venue's own website (live row moreno_valley_ca/main-library; changed field: website)", () => {
    const withSite = { ...MAIN_LIBRARY, website: 'https://www.moval.org/mv-library/location-main.html' };
    expect(org(buildEventJsonLd(story, [withSite], SITE, CANONICAL_URL, HERO_URL)).url).toBe('https://www.moval.org/mv-library/location-main.html');
  });
  it('is our facility page when the venue has no website (the fixture row has website null)', () => {
    expect(org(buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL)).url).toBe('https://morenovalleyview.com/facilities/main-library/');
  });
  it('is the site itself when the site is the organizer (virtual event, no venue)', () => {
    const online = baseStory({ title: 'Online Storytime via Zoom', body: 'Join us for this online storytime via Zoom -- link sent after registration.', venue_raw: null });
    expect(org(buildEventJsonLd(online, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL))).toEqual({ '@type': 'Organization', name: SITE.siteName, url: 'https://morenovalleyview.com/' });
  });
});

describe('buildEventJsonLd -- unresolved venue', () => {
  it('emits no Event markup at all for a venue with no registry match', () => {
    const story = baseStory({
      venue_raw: 'Building Up Lives Foundation,23185 Hemlock Ave suite a, Moreno Valley, CA 92557, USA',
    });
    const result = buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL);
    expect(result).toBeNull();
  });

  it('emits no Event markup for a facility resolved by name but missing a verified address', () => {
    // Never ship a Place claiming an address the registry doesn't actually
    // have -- resolving to a facility record isn't enough on its own.
    const story = baseStory({ venue_raw: 'City Hall' });
    const result = buildEventJsonLd(story, [CITY_HALL_UNVERIFIED_ADDRESS], SITE, CANONICAL_URL, HERO_URL);
    expect(result).toBeNull();
  });

  it('emits no Event markup when there is no venue at all', () => {
    const story = baseStory({ venue_raw: null });
    const result = buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL);
    expect(result).toBeNull();
  });
});

describe('buildEventJsonLd -- virtual event', () => {
  it('emits a VirtualLocation Event with no placeholder physical Place', () => {
    const story = baseStory({
      title: 'Online Storytime via Zoom',
      body: 'Join us for this online storytime via Zoom -- link sent after registration.',
      venue_raw: null,
    });
    const result = buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL);

    expect(result).not.toBeNull();
    expect(result!.location).toEqual({ '@type': 'VirtualLocation', url: CANONICAL_URL });
    expect(result!.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
    // No physical Place anywhere in the location -- location is a single
    // VirtualLocation object here, not an array containing a Place.
    expect(Array.isArray(result!.location)).toBe(false);
  });

  it('emits MixedEventAttendanceMode with both locations when a venue resolves and reads as virtual (hybrid)', () => {
    const story = baseStory({
      body: 'In person at the library, also streamed live via Zoom for anyone who cannot attend.',
      venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
    });
    const result = buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL);

    expect(result!.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
    expect(Array.isArray(result!.location)).toBe(true);
    const [place, virtual] = result!.location as Record<string, unknown>[];
    expect(place['@type']).toBe('Place');
    expect(virtual).toEqual({ '@type': 'VirtualLocation', url: CANONICAL_URL });
  });
});

describe('buildEventJsonLd -- non-event and recurring-series stories', () => {
  it('emits nothing for a non-event story', () => {
    const story = baseStory({ source_type: 'meeting' });
    expect(buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL)).toBeNull();
  });

  it('emits nothing for a recurring-series story, even with a resolved venue', () => {
    const story = baseStory({
      venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
      is_recurring_series: true,
    });
    expect(buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL)).toBeNull();
  });

  it('emits nothing for an event with no occurs_at', () => {
    const story = baseStory({
      occurs_at: null,
      venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA',
    });
    expect(buildEventJsonLd(story, [MAIN_LIBRARY], SITE, CANONICAL_URL, HERO_URL)).toBeNull();
  });
});

// Owner 2026-11-26 (Search Console, Glasgow: "missing description"): a withheld text gets the facts the page shows, never the source's
// own text. Real rows: glasgow stories event-333583 "Drawing Inspiration" (generated_by 'template', body repeats title and place, so it
// is withheld) and places the-burrell-collection.
describe('description when the text is withheld (Glasgow)', () => {
  const BURRELL: Facility = {
    ...MAIN_LIBRARY, id: 900, slug: 'the-burrell-collection', name: 'The Burrell Collection', category: 'museum',
    address: 'Pollokshaws Road, Pollok Country Park, Glasgow G43 1AT', aliases: [],
    street_address: 'Pollokshaws Road, Pollok Country Park', postal_code: 'G43 1AT',
  };
  const story = {
    ...baseStory({}), slug: 'event-333583', title: 'Drawing Inspiration', body: 'Drawing Inspiration at The Burrell Collection.',
    occurs_at: '2026-08-31T23:00:00.000Z', ends_at: null, venue_raw: 'The Burrell Collection', generated_by: 'template',
    meta: { venue: 'The Burrell Collection' },
  } as EventJsonLdStory;
  const GLASGOW = { cityName: 'Glasgow', region: 'Scotland', addressCountry: 'GB', siteName: 'Glasgow Loop', timezone: 'Europe/London', country: 'gb' as const, meetingsHaveTime: true };

  it('is the facts line (title, place, day), and there are no offers or performer', () => {
    const ld = buildEventJsonLd(story, [BURRELL], GLASGOW, 'https://glasgowloop.com/s/event-333583/', 'https://glasgowloop.com/og/event-333583.png')!;
    expect(ld.description).toMatch(/^Drawing Inspiration at The Burrell Collection, Tue(sday)? 1 Sep/);
    expect(ld.offers).toBeUndefined();
    expect(ld.performer).toBeUndefined();
  });
});
