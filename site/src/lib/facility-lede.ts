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

/** Builds the facility page's lede: the existing hand-written/sourced
 *  description with the address woven in as a second sentence -- never a
 *  content rewrite, never an AI call. `description`/`address` are each
 *  independently optional (the real data has neither missing today, but
 *  the DB schema allows it) -- same "resolved or nothing" rule the rest of
 *  this codebase's facility rendering already follows (see
 *  hasResolvedAddress() in lib/db.ts): returns whichever half is
 *  available, or null if neither is.
 */
export function buildFacilityLede(
  description: string | null,
  address: string | null,
  slug: string,
): string | null {
  if (!description && !address) return null;
  if (!address) return description;
  const connector = pickAddressConnector(slug);
  const addressSentence = `${connector} ${address}.`;
  return description ? `${description} ${addressSentence}` : addressSentence;
}
