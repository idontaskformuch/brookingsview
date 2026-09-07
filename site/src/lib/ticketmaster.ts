/** What's On Phase 3 -- Ticketmaster Discovery API adapter. Fetch +
 *  normalization only; NOT wired into buildEventFeed() or any page this
 *  phase (see this file's own module comment below for why). Callable in
 *  isolation from scripts/dump-event-ranking.ts and from tests.
 *
 *  Brookings-only for now -- don't call this for other towns yet (Phase 7).
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
  _embedded?: { venues?: { name?: string }[] };
  classifications?: { primary?: boolean; segment?: { name?: string } }[];
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
 *  being forced into one of those -- ticketUrl and priceRangeText are
 *  genuinely Ticketmaster-specific (an SDSU arts_culture event has neither
 *  a paid-ticket link nor a price range in this codebase's data model).
 *  imageUrl is captured now but deliberately unused until Phase 4
 *  (resolveImage() integration) -- a dead field today, not wasted work,
 *  since re-fetching it later would mean a second live API call. */
export interface TicketmasterEvent {
  id: string;
  title: string;
  venueName: string | null;
  ticketUrl: string;
  imageUrl: string | null;
  priceRangeText: string | null;
}

function formatPriceRange(ranges: RawTicketmasterEvent['priceRanges']): string | null {
  const range = ranges?.[0];
  if (!range || range.min == null || range.max == null) return null;
  const currency = range.currency === 'USD' ? '$' : `${range.currency ?? ''} `;
  return range.min === range.max
    ? `${currency}${range.min}`
    : `${currency}${range.min} - ${currency}${range.max}`;
}

/** Highest-resolution image Discovery API offers -- widest `width`, not
 *  just the first entry (the array's own order isn't documented as
 *  size-sorted). Returns null (not a placeholder) when the event has no
 *  `images` array at all, same "never guess" convention this codebase
 *  already uses for image_alt/image_path elsewhere. */
function bestImageUrl(images: RawTicketmasterEvent['images']): string | null {
  if (!images || images.length === 0) return null;
  return images.reduce((best, img) => (img.width > best.width ? img : best), images[0]).url;
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

/** Pure -- unit-tested directly against captured fixture responses (see
 *  ticketmaster.test.ts), no network. `dates.start.dateTime` is Discovery
 *  API's own UTC instant when present; a small number of listings only
 *  carry `localDate`/`localTime` (no timezone conversion available from the
 *  API response itself for those) -- occurs_at is null rather than guessed
 *  in that case, same "never fabricate a time" rule dayIndex()/localHour()
 *  already enforce in lib/events.ts. */
export function normalizeTicketmasterEvent(raw: RawTicketmasterEvent): TicketmasterFeedItem {
  const event: TicketmasterEvent = {
    id: raw.id,
    title: raw.name,
    venueName: raw._embedded?.venues?.[0]?.name ?? null,
    ticketUrl: raw.url ?? '',
    imageUrl: bestImageUrl(raw.images),
    priceRangeText: formatPriceRange(raw.priceRanges),
  };
  return {
    sourceKind: 'ticketmaster',
    occurs_at: raw.dates?.start?.dateTime ?? null,
    ticketmasterEvent: event,
  };
}

/**
 * Fetches every non-Sports Brookings event Discovery API currently lists,
 * normalized -- see isSportsEvent() above for why Sports is excluded here,
 * at the fetch layer, rather than left for a caller to filter.
 * Never throws -- every failure mode (missing/invalid key, rate limit, 5xx,
 * network error) logs and resolves to `[]`, per this phase's own
 * requirement that a build must succeed identically whether or not the key
 * is valid. Not gated on an `enabled` flag itself -- callers (the dump
 * script, tests, and eventually Phase 7's real wiring) decide whether to
 * call this at all; this function's own job is just "fetch safely or fail
 * quietly," not policy.
 */
export async function fetchTicketmasterEvents(
  cityName: string,
  stateCode: string,
): Promise<TicketmasterFeedItem[]> {
  const apiKey = import.meta.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    console.warn('[ticketmaster] TICKETMASTER_API_KEY not set -- skipping fetch, returning no events.');
    return [];
  }

  const results: RawTicketmasterEvent[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(PACING_DELAY_MS);

      const url = new URL(DISCOVERY_API_BASE);
      url.searchParams.set('apikey', apiKey);
      url.searchParams.set('city', cityName);
      url.searchParams.set('stateCode', stateCode);
      url.searchParams.set('size', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));

      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`[ticketmaster] Discovery API returned HTTP ${res.status} for ${cityName}, ${stateCode} -- stopping, returning what was fetched so far.`);
        break;
      }

      const body = (await res.json()) as DiscoveryApiResponse;
      const events = body._embedded?.events ?? [];
      results.push(...events);

      const totalPages = body.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
    }
  } catch (err) {
    console.warn(`[ticketmaster] fetch failed for ${cityName}, ${stateCode}: ${err instanceof Error ? err.message : String(err)} -- returning no events.`);
    return [];
  }

  return results.filter((raw) => !isSportsEvent(raw)).map(normalizeTicketmasterEvent);
}

/** The actual "is this reachable from a real page" gate: checks
 *  `siteConfig.ticketmaster?.enabled` BEFORE doing anything else -- no
 *  network call, no API key read, just an immediate `[]` when disabled
 *  (which is every town today, see site-config.ts). This is the function a
 *  real page would call once Phase 7 wires this in for real; nothing calls
 *  it yet (see this file's own module comment), but it exists now so that
 *  wiring is a one-line addition, not new design work. */
export async function getTicketmasterEventsForTown(
  siteConfig: { cityName: string; stateAbbr: string; ticketmaster?: { enabled: boolean } },
): Promise<TicketmasterFeedItem[]> {
  if (!siteConfig.ticketmaster?.enabled) return [];
  return fetchTicketmasterEvents(siteConfig.cityName, siteConfig.stateAbbr);
}
