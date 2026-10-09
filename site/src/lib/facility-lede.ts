/** Sitewide title/H1/lede handoff, facility-detail page-type rule: the
 *  lede "must include the street address in prose form." None of the 38
 *  real facility descriptions across all three towns currently mention
 *  their own address (confirmed against data/facilities/*.json, not
 *  assumed) -- hand-rewriting all of them, and every one added later, was
 *  rejected in favor of synthesizing the address onto the existing
 *  description at render time. A single fixed template ("{description}
 *  Located at {address}.") read as mechanical repeated 16+ times on one
 *  town's own /facilities/ index alone -- varied instead across a small
 *  set of natural connectors, chosen deterministically per facility (same
 *  "stable per item, no flicker on rebuild" reasoning as lib/images.ts's
 *  pickFromPool() hashing on a story's own slug) so the SAME facility
 *  always reads the same way, while different facilities on the same
 *  index page don't all read identically.
 */

const ADDRESS_CONNECTORS = ["It's located at", 'Find it at', "You'll find it at", 'Address:'];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** `slug` is the deterministic seed -- stable per facility, town-unique,
 *  already the identity this codebase hashes on elsewhere. Never a
 *  Math.random()-style pick, which would reassign the connector on every
 *  rebuild for no reason. */
export function pickAddressConnector(slug: string): string {
  return ADDRESS_CONNECTORS[hashString(slug) % ADDRESS_CONNECTORS.length];
}

/** Answer-engine-visibility handoff, Section 5: target 40-60 words for a
 *  reference-page lede. Real, sitewide numbers checked before writing this
 *  (see NEEDS-HUMAN-REVIEW.md): 18 of 114 facilities have no description
 *  at all, and most lack hours_text/phone too -- for those, no amount of
 *  code can reach 40-60 words without inventing a fact this codebase's own
 *  "verify or omit, never guess" rule forbids. This only ever appends
 *  fields that are ALREADY real and already rendered elsewhere on the same
 *  page (the `<dl class="facts">` block) -- never new information, just
 *  more of what's already there, in the lede's own prose voice. */
function pickHoursConnector(slug: string): string {
  const connectors = ['Hours:', "It's open", 'Open'];
  return connectors[hashString(`${slug}-hours`) % connectors.length];
}

function pickPhoneConnector(slug: string): string {
  const connectors = ['Reach it at', 'Call', 'Phone:'];
  return connectors[hashString(`${slug}-phone`) % connectors.length];
}

/** Builds the facility page's lede: the existing hand-written/sourced
 *  description with the address woven in as a second sentence, then real
 *  hours/phone facts appended when present -- never a content rewrite,
 *  never an AI call. Every argument is independently optional (real data
 *  has plenty of gaps -- see this function's own doc comment above) --
 *  same "resolved or nothing" rule the rest of this codebase's facility
 *  rendering already follows (see hasResolvedAddress() in lib/db.ts):
 *  returns whichever parts are available, or null if none are.
 */
export function buildFacilityLede(
  description: string | null,
  address: string | null,
  slug: string,
  hoursText: string | null = null,
  phone: string | null = null,
): string | null {
  const sentences: string[] = [];
  if (description) sentences.push(description);
  if (address) sentences.push(`${pickAddressConnector(slug)} ${address}.`);
  if (hoursText) sentences.push(`${pickHoursConnector(slug)} ${hoursText}.`);
  if (phone) sentences.push(`${pickPhoneConnector(slug)} ${phone}.`);
  return sentences.length > 0 ? sentences.join(' ') : null;
}

/** Phase 2, item 2f (2026-10-09): a real, working map link built from data
 *  already on the row -- never a new fact, just an existing one (lat/lon
 *  when geocoded, the already-verified address string otherwise) presented
 *  as a clickable Google Maps search URL. This is why NO Broomfield
 *  facility needs a geocoding pass to get a working map link: every
 *  facility with a real address already has everything this needs. Prefers
 *  lat/lon (an exact pin) over the address query (Google's own geocoding,
 *  one step removed) when both exist. Returns null only when there's
 *  truly nothing to search on at all -- a facility with neither is already
 *  the thin-noindex case (see facilities/[slug].astro's own
 *  isThinFacility). */
export function facilityMapLink(lat: number | null, lon: number | null, address: string | null): string | null {
  if (lat != null && lon != null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

/** `parts` already in the fixed Hours/Address/Phone display order --
 *  "A, B & C" (no Oxford comma), "A & B" for two, "A" for one, '' for
 *  none (never a dangling "— | Site"). */
function joinElementParts(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return ` — ${parts[0]}`;
  const last = parts[parts.length - 1];
  return ` — ${parts.slice(0, -1).join(', ')} & ${last}`;
}

/** Phase 2, item 2f (2026-10-09): the dynamic "— Hours, Address & Phone"
 *  title suffix -- names only the elements THIS facility actually has
 *  (most Broomfield parks have an address and nothing else; a handful of
 *  civic buildings have all three). Returns '' (not a dangling "— |
 *  Site") when none are present, so resolvePageMeta's titlePattern
 *  ('{FacilityName}{Elements} | {Site}') collapses cleanly to just the
 *  bare name.
 *
 *  Length-budgeted, 2026-10-09 (owner-caught before shipping): real data
 *  across all three towns showed several facility names are ALREADY
 *  50-70 chars alone (e.g. "Moreno Valley Community Hospital, a Kaiser
 *  Foundation Hospital", "Brookings City Hall (City & County Government
 *  Center)") -- the full 25-char suffix pushed some titles to 93-95
 *  chars, nowhere near readable in a real SERP snippet even before
 *  counting " | {Site}". `facilityNameLength` (the real name's own
 *  length, not counting the suffix or site) + this suffix must fit
 *  within `budget` (default 60, per the owner's own "~60 chars" target)
 *  or elements get dropped -- Phone first (least essential once a reader
 *  is already on the right page), then Hours, keeping Address alone as
 *  the last thing to drop (the single most expected fact on a local
 *  facility page). A facility name alone already at or past budget gets
 *  no suffix at all -- the same "known, unavoidable exception" the
 *  city-hall title already documents, extended here rather than ever
 *  truncating a facility's own real name to make room. */
export function facilityTitleElements(
  hasHours: boolean, hasAddress: boolean, hasPhone: boolean,
  facilityNameLength: number, budget = 60,
): string {
  const attempts: [boolean, boolean, boolean][] = [
    [hasHours, hasAddress, hasPhone],
    [hasHours, hasAddress, false],
    [false, hasAddress, false],
    // Real data has address on nearly every facility that has anything at
    // all, so these last two rarely fire -- kept for the edge case of a
    // facility with hours or phone but genuinely no address, so it still
    // gets SOMETHING rather than silently falling through to ''.
    [hasHours, false, false],
    [false, false, hasPhone],
  ];
  for (const [hours, address, phone] of attempts) {
    const parts: string[] = [];
    if (hours) parts.push('Hours');
    if (address) parts.push('Address');
    if (phone) parts.push('Phone');
    const suffix = joinElementParts(parts);
    if (suffix === '') continue;
    if (facilityNameLength + suffix.length <= budget) return suffix;
  }
  return '';
}
