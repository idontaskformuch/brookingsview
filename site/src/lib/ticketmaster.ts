/** What's On -- Ticketmaster Discovery API adapter. Built Phase 3 as fetch +
 *  normalization only, deliberately NOT wired into buildEventFeed() or any
 *  page (see TicketmasterFeedItem's own comment for why that stayed true
 *  through Phase 4 too). Phase 5 (site/src/pages/whats-on/) is the first
 *  real caller -- gated behind SiteConfig.hasWhatsOn and
 *  siteConfig.ticketmaster.enabled, both true for all three towns as of
 *  Phase 7 and its venue-curation follow-up.
 */

const DISCOVERY_API_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

/** Discovery API's documented limits: 5 requests/sec, 5000 calls/day. A
 *  single town fetch realistically needs 1-2 pages (size=200 per page), but
 *  this paces sequential page requests and hard-caps the page count so a
 *  future town with an unexpectedly large result set can't accidentally
 *  burst past the per-second limit or run away fetching pages forever. */
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const PACING_DELAY_MS = 250; // 4 req/sec, under the 5/sec documented ceiling

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal shape of what this adapter reads from a Discovery API event --
 *  not the full response schema, just the fields normalizeTicketmasterEvent()
 *  uses. Fields are optional/nullable throughout because Discovery API omits
 *  rather than nulls a missing field (e.g. an event with no known venue, or
 *  no image, simply has no `_embedded.venues` / `images` key at all). */
export interface RawTicketmasterEvent {
  id: string;
  name: string;
  url?: string;
  images?: { url: string; width: number; height: number; ratio?: string }[];
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string } };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  _embedded?: {
    venues?: {
      /** Discovery API's own stable venue identifier -- preferred over
       *  `name` for tier matching (see lib/venue-tiers.ts's venueTierFor())
       *  since a display name can drift (sponsorship renames are common for
       *  arenas) while this id doesn't. */
      id?: string;
      name?: string;
      address?: { line1?: string };
      city?: { name?: string };
      state?: { stateCode?: string };
      postalCode?: string;
      location?: { latitude?: string; longitude?: string };
      /** Discovery API computes this itself, in whatever `unit` the search
       *  request asked for (this adapter always requests `unit=miles`, see
       *  fetchTicketmasterEvents()) -- confirmed live: 3.57 for Dana J.
       *  Dykhouse Stadium (Brookings) and 50.06 for Washington Pavilion of
       *  Arts & Science (Sioux Falls) against a 75-mile Brookings-centered
       *  search. Using the API's own number instead of computing haversine
       *  distance here avoids a whole separate distance-math implementation
       *  (and its own bug surface) for a value the API already hands over. */
      distance?: number;
    }[];
    /** The production/tour this event belongs to (e.g. "Disney On Ice
     *  presents Find Your Hero") -- Discovery API's own stable grouping key
     *  for "same real production, different date," used by
     *  lib/whats-on.ts's collapseMarqueeRuns() to fold multiple tour stops
     *  into one Marquee card. An event can list more than one attraction
     *  (a specific production plus a broader franchise entry) -- only the
     *  first/primary one is used, matching how classifications[0] is
     *  already treated as authoritative elsewhere in this file. */
    attractions?: { id?: string; name?: string }[];
  };
  classifications?: {
    primary?: boolean;
    segment?: { name?: string };
    /** Discovery API's own signal for a non-event listing (a parking pass,
     *  a seating upsell, ...) riding along in the events endpoint --
     *  confirmed live: every one of 3 real "Premium Perch Add-On" listings
     *  (upsell add-ons for Denny Sanford PREMIER Center shows) carried
     *  `type.name === 'Upsell'`, while every one of the other 37 real
     *  events in the same feed had this either absent or 'Undefined'. See
     *  isNonEventListing() below. */
    type?: { name?: string };
  }[];
}

interface DiscoveryApiResponse {
  _embedded?: { events?: RawTicketmasterEvent[] };
  page?: { totalPages?: number; number?: number };
}

/** What's On Phase 3's own FeedItem-shaped envelope for a normalized
 *  Ticketmaster event -- deliberately NOT unioned into events.ts's exported
 *  `FeedItem` type this phase (see this file's module comment for why:
 *  doing so would force every one of Phase 1's six real consumer files to
 *  grow a third type-narrowing branch purely to satisfy the compiler, for a
 *  source that never actually flows through them while `enabled: false`).
 *  Structurally matches FeedItem's `{ sourceKind, occurs_at, <payload> }`
 *  shape on purpose, so wiring it into the real union later (Phase 7) is a
 *  mechanical, low-risk change, not a redesign. */
export interface TicketmasterFeedItem {
  sourceKind: 'ticketmaster';
  occurs_at: string | null;
  ticketmasterEvent: TicketmasterEvent;
}

/** Fields that don't fit story/arts' existing shape stay here rather than
 *  being forced into one of those -- ticketUrl and price are genuinely
 *  Ticketmaster-specific (an SDSU arts_culture event has neither a
 *  paid-ticket link nor a price range in this codebase's data model).
 *  imageUrl/imageWidth/imageHeight are wired into lib/images.ts's
 *  resolveImage() as of Phase 4, as a new top tier above article/venue/
 *  category -- width/height are captured (not just the URL) so that tier
 *  can return an accurate ImageRef the same way every other tier does,
 *  rather than guessing a fixed size for images whose real aspect ratio
 *  varies per event (confirmed live: real captured widths range from 640
 *  to 2048px depending on which renditions Discovery API has for a given
 *  event).
 *
 *  venueLatitude/venueLongitude/venueAddress/venueCity/venueStateCode/
 *  venuePostalCode (What's On Phase 5): real venue geo/address data,
 *  captured for two things Phase 5 needs that Phase 3/4 didn't --
 *  lib/geo.ts's distance-from-Brookings label (the anti-doorway-pattern
 *  transparency requirement) and a real schema.org PostalAddress/
 *  GeoCoordinates on the detail page, matching the same quality bar
 *  lib/event-jsonld.ts already holds local venues to. Null when Discovery
 *  API's own `_embedded.venues` is absent for an event (confirmed this
 *  does happen live) -- never guessed.
 *
 *  priceMin/priceMax/priceCurrency (raw numbers, What's On Phase 5): kept
 *  alongside priceRangeText (the pre-formatted display string) rather than
 *  parsed back out of it, so Event JSON-LD's `offers` can use real numeric
 *  values instead of re-parsing display text.
 *
 *  attractionId (What's On Phase 5 follow-up, "Tour-Run Collapsing"): the
 *  production/tour this event belongs to, used by lib/whats-on.ts's
 *  collapseMarqueeRuns() to fold multiple real tour stops (confirmed live:
 *  6 separate Disney On Ice dates, all sharing one attraction id) into one
 *  Marquee card rather than letting them crowd out other distinct acts. */
export interface TicketmasterEvent {
  id: string;
  title: string;
  attractionId: string | null;
  venueId: string | null;
  venueName: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueStateCode: string | null;
  venuePostalCode: string | null;
  /** Miles from the search origin (this town's own coordinates) -- see the
   *  raw venue type's own comment on `distance` above. Null when Discovery
   *  API's own venue data is absent, same as every other venue field. */
  venueDistanceMiles: number | null;
  ticketUrl: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  priceRangeText: string | null;
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string | null;
}

function formatPriceRange(ranges: RawTicketmasterEvent['priceRanges']): string | null {
  const range = ranges?.[0];
  if (!range || range.min == null || range.max == null) return null;
  const currency = range.currency === 'USD' ? '$' : `${range.currency ?? ''} `;
  return range.min === range.max
    ? `${currency}${range.min}`
    : `${currency}${range.min} - ${currency}${range.max}`;
}

function parseCoordinate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Below this, a venue reads as "in town," not a real distance away --
 *  see this function's own doc comment for why a small threshold matters
 *  here specifically. */
const IN_TOWN_THRESHOLD_MILES = 5;

/**
 * What's On Phase 5's anti-doorway-pattern transparency label -- the
 * original feature intent was "regional radius with drive-time always
 * shown so it isn't a hidden doorway pattern," i.e. never let a reader
 * discover only after clicking that "a local event" is actually 50 miles
 * away. Distance, not drive time (see the Phase 5 handoff's own
 * recommendation: straight-line/API-computed distance is free and honestly
 * labeled as distance; a routing API for real drive-time is a real
 * recurring cost not worth paying before this page's value is proven --
 * a one-line swap later if it ever is).
 *
 * Below IN_TOWN_THRESHOLD_MILES, returns "In <cityName>" rather than a
 * number -- "~1 mile away" (or worse, "~0 miles away" for a venue Discovery
 * API places almost exactly at the search origin) reads as a bug, not a
 * courtesy, for a venue that's genuinely in the town itself. `null` venue
 * distance (Discovery API had no venue data at all) returns null -- no
 * label, never a fabricated "nearby."
 */
export function distanceLabel(miles: number | null, cityName: string): string | null {
  if (miles == null) return null;
  if (miles < IN_TOWN_THRESHOLD_MILES) return `In ${cityName}`;
  return `~${Math.round(miles)} miles away`;
}

/** Highest-resolution image Discovery API offers -- widest `width`, not
 *  just the first entry (the array's own order isn't documented as
 *  size-sorted). Returns null (not a placeholder) when the event has no
 *  `images` array at all, same "never guess" convention this codebase
 *  already uses for image_alt/image_path elsewhere. Returns the real
 *  width/height alongside the URL, not just the URL -- resolveImage()
 *  needs an accurate size, the same way every other tier already provides
 *  one, rather than a guessed fixed size. */
function bestImage(images: RawTicketmasterEvent['images']): { url: string; width: number; height: number } | null {
  if (!images || images.length === 0) return null;
  return images.reduce((best, img) => (img.width > best.width ? img : best), images[0]);
}

/** Athletics/Sports filter -- What's On is meant to surface entertainment
 *  content, not sports; Brookings' Athletics inventory (SDSU football,
 *  volleyball) is already covered by a completely separate, pre-existing
 *  pipeline (gojacks.com's own schedule scrape, feeding /university and
 *  /jackrabbits). Confirmed live 2026-09-07: EVERY one of 14 real Discovery
 *  API results for Brookings, SD -- all 13 SDSU games AND the one
 *  non-SDSU commercial event ("MaskedMania Wrestling") -- carried
 *  `segment.name === 'Sports'`, so this filter is broad by Ticketmaster's
 *  own taxonomy, not an SDSU-specific keyword match.
 *
 *  Checks the classification marked `primary: true` (Discovery API can list
 *  more than one; only the primary one is authoritative) -- falls back to
 *  the first entry if none is explicitly marked primary, since the API
 *  schema doesn't structurally guarantee one exists even though every
 *  captured real event had exactly one. An event with no classifications at
 *  all is kept (never excluded on missing data, same "uncertain means
 *  don't guess" rule as isFreeEvent() in lib/events.ts -- there just isn't
 *  enough signal to call it Sports). */
export function isSportsEvent(raw: RawTicketmasterEvent): boolean {
  const classification = raw.classifications?.find((c) => c.primary) ?? raw.classifications?.[0];
  return classification?.segment?.name === 'Sports';
}

/** What's On Phase 5 follow-up ("Ticket-Type Filtering") -- excludes a
 *  non-event listing (a seating/parking/upsell add-on Discovery API returns
 *  alongside real events in the same endpoint) before it ever reaches the
 *  ranker. Structural signal, not a name/title match: real data confirmed
 *  Discovery API classifies these with `classifications[0].type.name ===
 *  'Upsell'` -- every one of 3 real "Premium Perch Add-On" listings
 *  (Denny Sanford PREMIER Center) carried this, and none of the other 37
 *  real events in the same live feed did (they were 'Undefined' or had no
 *  `type` at all). No other non-event listing shape (parking passes,
 *  meet-and-greets, shuttle passes) was found in that same live check --
 *  if one appears later with a different signal, it needs its own check,
 *  not a broadened version of this one. Same "primary classification,
 *  fallback to first entry" precedence as isSportsEvent() above -- an
 *  event with no classifications at all is kept, never excluded on missing
 *  data. */
export function isNonEventListing(raw: RawTicketmasterEvent): boolean {
  const classification = raw.classifications?.find((c) => c.primary) ?? raw.classifications?.[0];
  return classification?.type?.name === 'Upsell';
}

/** Pure -- unit-tested directly against captured fixture responses (see
 *  ticketmaster.test.ts), no network. `dates.start.dateTime` is Discovery
 *  API's own UTC instant when present; a small number of listings only
 *  carry `localDate`/`localTime` (no timezone conversion available from the
 *  API response itself for those) -- occurs_at is null rather than guessed
 *  in that case, same "never fabricate a time" rule dayIndex()/localHour()
 *  already enforce in lib/events.ts. */
export function normalizeTicketmasterEvent(raw: RawTicketmasterEvent): TicketmasterFeedItem {
  const image = bestImage(raw.images);
  const venue = raw._embedded?.venues?.[0];
  const priceRange = raw.priceRanges?.[0];
  const event: TicketmasterEvent = {
    id: raw.id,
    title: raw.name,
    attractionId: raw._embedded?.attractions?.[0]?.id ?? null,
    venueId: venue?.id ?? null,
    venueName: venue?.name ?? null,
    venueLatitude: parseCoordinate(venue?.location?.latitude),
    venueLongitude: parseCoordinate(venue?.location?.longitude),
    venueAddress: venue?.address?.line1 ?? null,
    venueCity: venue?.city?.name ?? null,
    venueStateCode: venue?.state?.stateCode ?? null,
    venuePostalCode: venue?.postalCode ?? null,
    venueDistanceMiles: venue?.distance ?? null,
    ticketUrl: raw.url ?? '',
    imageUrl: image?.url ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    priceRangeText: formatPriceRange(raw.priceRanges),
    priceMin: priceRange?.min ?? null,
    priceMax: priceRange?.max ?? null,
    priceCurrency: priceRange?.currency ?? null,
  };
  return {
    sourceKind: 'ticketmaster',
    occurs_at: raw.dates?.start?.dateTime ?? null,
    ticketmasterEvent: event,
  };
}

/**
 * Fetches every non-Sports, real-event listing Discovery API lists within
 * `radiusMiles` of (`latitude`, `longitude`), normalized -- see
 * isSportsEvent() and isNonEventListing() above for why both are excluded
 * here, at the fetch layer, rather than left for a caller (or the ranker)
 * to filter.
 *
 * Geographic search (`latlong`/`radius`/`unit`), NOT a `city`/`stateCode`
 * exact-tag match -- a real scoping bug in the original Phase 3 version,
 * caught before Phase 5: a city-tag query structurally excludes everything
 * outside a town's own city boundary, including a real nearby market like
 * Sioux Falls (~53mi from Brookings) regardless of what's actually playing
 * there. The original What's On spec's own intent was a regional radius,
 * not a city-limits match.
 *
 * Never throws -- every failure mode (missing/invalid key, rate limit, 5xx,
 * network error) logs and resolves to `[]`, per this phase's own
 * requirement that a build must succeed identically whether or not the key
 * is valid. Every outcome -- not just failures -- gets exactly one clearly
 * worded, distinct log line (see the end of this function and each
 * `::warning::` below): a 2026-09-08 production incident (What's On empty
 * on every town, cause chased through four wrong theories in one session)
 * happened specifically because only SOME outcomes were visible and the
 * rest looked identical to "no events in the area" -- first a missing key,
 * then (after that was fixed) a plain, non-`::warning::` line for anything
 * that wasn't 401/403, meaning a 429 rate-limit response was AS silent as
 * the original missing-key bug had been. `::warning::` is a GitHub Actions
 * workflow command -- Actions scans every step's stdout/stderr for that
 * literal pattern, not just lines a workflow's own `run:` script echoes, so
 * it surfaces as a real annotation in the Actions UI summary rather than a
 * line buried in a multi-thousand-line build log (same mechanism this
 * repo's own workflow YAML already uses for `::error::`). Every non-success
 * outcome below uses it now, not just auth errors. Not gated on an
 * `enabled` flag itself -- callers (the dump script, tests, and
 * getTicketmasterEventsForTown() below) decide whether to call this at
 * all; this function's own job is just "fetch safely or fail quietly," not
 * policy.
 */
export async function fetchTicketmasterEvents(
  latitude: number,
  longitude: number,
  radiusMiles: number,
): Promise<TicketmasterFeedItem[]> {
  const geoLabel = `${latitude},${longitude} (${radiusMiles}mi)`;
  const apiKey = import.meta.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    console.warn(`::warning::[ticketmaster] TICKETMASTER_API_KEY not set for ${geoLabel} -- skipping fetch, returning no events. If this town is supposed to have Ticketmaster data, check this workflow's own Build step env block for this key.`);
    return [];
  }

  const results: RawTicketmasterEvent[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(PACING_DELAY_MS);

      const url = new URL(DISCOVERY_API_BASE);
      url.searchParams.set('apikey', apiKey);
      url.searchParams.set('latlong', `${latitude},${longitude}`);
      url.searchParams.set('radius', String(radiusMiles));
      url.searchParams.set('unit', 'miles');
      url.searchParams.set('size', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));

      let res = await fetch(url.toString());

      // One retry, 429 (rate limit) only -- see this function's own module
      // comment on the 2026-09-08 incident: three independent call sites
      // per build (getTicketmasterEventsForTown() below now memoizes
      // against that, but a transient collision with ANOTHER town's
      // overlapping build, or a future new call site, is still possible)
      // can burst past Discovery API's 5 req/sec ceiling. A single retry
      // after a real pause is enough to ride out a momentary collision
      // without turning a genuine outage into a long hang -- never looped
      // or exponential, on purpose.
      if (res.status === 429) {
        console.warn(`::warning::[ticketmaster] Discovery API rate-limited (HTTP 429) for ${geoLabel}, page ${page} -- retrying once after a pause.`);
        await sleep(PACING_DELAY_MS * 4);
        res = await fetch(url.toString());
      }

      if (!res.ok) {
        // A real try/catch, not `.catch()` chained onto the call -- if
        // `res.text` isn't a function at all (a non-standard Response-like
        // object), calling it throws SYNCHRONOUSLY, before there's a
        // promise for `.catch()` to attach to, and that would otherwise
        // propagate out to the outer try/catch and get misreported as a
        // network error instead of the real HTTP status.
        let bodySnippet = '';
        try {
          bodySnippet = (await res.text()).slice(0, 300);
        } catch {
          // no readable body -- omit it, don't fail the whole outcome
          // report over a body-reading problem.
        }
        if (res.status === 401 || res.status === 403) {
          // 401/403 specifically means the key WAS sent but Discovery API
          // rejected it (wrong, revoked, or rotated) -- a different and,
          // before this, equally silent failure mode from a key that never
          // arrived at all.
          console.warn(`::warning::[ticketmaster] Discovery API auth error (HTTP ${res.status}) for ${geoLabel} -- the key was sent but rejected. Check that TICKETMASTER_API_KEY is set correctly and hasn't been revoked or rotated. ${bodySnippet}`);
        } else if (res.status === 429) {
          console.warn(`::warning::[ticketmaster] Discovery API still rate-limited (HTTP 429) for ${geoLabel} after one retry -- stopping, returning what was fetched so far (${results.length} event(s) from earlier pages). ${bodySnippet}`);
        } else {
          console.warn(`::warning::[ticketmaster] Discovery API returned HTTP ${res.status} for ${geoLabel} -- stopping, returning what was fetched so far (${results.length} event(s) from earlier pages). ${bodySnippet}`);
        }
        break;
      }

      const body = (await res.json()) as DiscoveryApiResponse;
      const events = body._embedded?.events ?? [];
      results.push(...events);

      const totalPages = body.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
    }
  } catch (err) {
    console.warn(`::warning::[ticketmaster] fetch failed (network error) for ${geoLabel}: ${err instanceof Error ? err.message : String(err)} -- returning no events.`);
    return [];
  }

  const normalized = results
    .filter((raw) => !isSportsEvent(raw) && !isNonEventListing(raw))
    .map(normalizeTicketmasterEvent);

  // The success case, always logged (not just failures) -- a plain
  // console.log, not a ::warning::, since a real quiet radius is a
  // legitimate, unremarkable outcome and shouldn't read as a problem in
  // the Actions UI. Still gives every build an explicit, unambiguous line
  // to point at either way, instead of silence standing in for "0 events
  // in the API response" (a fact worth knowing) being indistinguishable
  // from "the fetch never really happened" (a bug).
  console.log(`[ticketmaster] fetched ${normalized.length} event(s) for ${geoLabel} (${results.length} raw, before Sports/Upsell filtering)`);
  return normalized;
}

/** The actual "is this reachable from a real page" gate: checks
 *  `siteConfig.ticketmaster?.enabled` BEFORE doing anything else -- no
 *  network call, no API key read, just an immediate `[]` when disabled.
 *  This is the function pages/whats-on/index.astro and lib/cityStatus.ts's
 *  resolveWhatsOn() actually call. */
export async function getTicketmasterEventsForTown(
  siteConfig: { ticketmaster?: { enabled: boolean; latitude: number; longitude: number; radiusMiles: number } },
): Promise<TicketmasterFeedItem[]> {
  if (!siteConfig.ticketmaster?.enabled) return [];
  const { latitude, longitude, radiusMiles } = siteConfig.ticketmaster;
  return fetchTicketmasterEvents(latitude, longitude, radiusMiles);
}
