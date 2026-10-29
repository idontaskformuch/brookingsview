/** Display names for the evening layer (owner 2026-10-29, Q3 on /tonight): one spelling per venue and readable titles.
 *
 *  canonicalVenue(): a canonical venue list per town (src/config/venue-names.json: canonical name -> spelling variants). Sources spell the
 *  same venue differently ("Oran Mor" from Ticketmaster, "Òran Mór" from OpenStreetMap, "Oran Mor Auditorium" from a venue calendar);
 *  matching ignores case, accents, a leading "The" and punctuation, and the page shows the canonical spelling.
 *  displayTitle(): a title written entirely in capitals ("MAMA TERRA") is set in ordinary capitalisation; known abbreviations stay. */
import NAMES from '../config/venue-names.json';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, ' ').trim();

type NameFile = Record<string, Record<string, string[]>>;

/** variant key -> canonical name, per town. */
export function buildVenueIndex(file: Record<string, string[]>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(file)) {
    index.set(fold(canonical), canonical);
    for (const v of variants) index.set(fold(v), canonical);
  }
  return index;
}

const INDEXES = new Map<string, Map<string, string>>();
function indexFor(townId: string): Map<string, string> {
  let idx = INDEXES.get(townId);
  if (!idx) { idx = buildVenueIndex((NAMES as NameFile)[townId] ?? {}); INDEXES.set(townId, idx); }
  return idx;
}

export function canonicalVenue(name: string | null | undefined, townId: string, index?: Map<string, string>): string | null {
  if (!name) return null;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return (index ?? indexFor(townId)).get(fold(trimmed)) ?? trimmed;
}

/** Abbreviations that stay in capitals when a title is re-cased. */
const KEEP_UPPER = new Set([
  'OVO', 'SEC', 'DJ', 'DJS', 'UK', 'USA', 'US', 'BBC', 'SSO', 'RSNO', 'UFC', 'WWE', 'NBA', 'NFL', 'NHL', 'MLB', 'MLS', 'FC', 'AFC', 'CU', 'DU', 'TV', 'LP', 'EP',
  'VIP', 'BYOB', 'LGBT', 'LGBTQ', 'NYE', 'SWG3', 'IHOP', 'HQ', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'UCLA', 'USC', 'SDSU', 'CSU',
  'RIP', 'MC', 'TBA',
]);
const SMALL = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'v', 'x', 'with', 'de', 'la', 'le']);

/** A title with letters and no lowercase letter at all. Mixed titles ("PRTY x HSSH: HRDR present CADZOW") are left exactly as they are. */
export function isAllCaps(title: string): boolean {
  return /[A-Z]{3}/.test(title) && !/[a-z]/.test(title);
}

function caseWord(word: string, first: boolean): string {
  const bare = word.replace(/[^A-Za-z0-9']/g, '');
  if (KEEP_UPPER.has(bare.toUpperCase())) return word;
  if (/\d/.test(bare)) return word;
  const lower = word.toLowerCase();
  if (!first && SMALL.has(bare.toLowerCase())) return lower;
  // O'NEILLS -> O'Neills, DON'T -> Don't
  return lower.replace(/(^|[^a-z'])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
    .replace(/(^|[^a-z])([a-z])'([a-z]{3,})/gi, (_m, pre: string, a: string, rest: string) => `${pre}${a.toUpperCase()}'${rest[0].toUpperCase()}${rest.slice(1)}`);
}

export function displayTitle(title: string): string {
  if (!isAllCaps(title)) return title;
  let first = true;
  return title.split(/(\s+)/).map((part) => {
    if (/^\s+$/.test(part) || part === '') return part;
    const out = caseWord(part, first);
    first = /[:\-–—]$/.test(part);
    return out;
  }).join('');
}
