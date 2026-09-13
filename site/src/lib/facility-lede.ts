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
