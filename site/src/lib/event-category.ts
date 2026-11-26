/** THE category of an event (owner 2026-11-26 (8): one category function for every page). One of the library's categories (colour + icon),
 *  or null. Order: the source's own category (a calendar's label, Ticketmaster's segment and genre, SDSU's category), then the title, and
 *  the venue's name only as a last resort. Riverside Christmas Market (Glasgow Life, "Museums & exhibitions") is Arts on every page; before,
 *  /events/ said Food & drink (title and label read as one string) and /this-week/ Arts (title, venue and label, other rules).
 *  Rule-based and deliberately conservative: a miss shows a neutral row, a wrong guess would colour a row with a meaning it does not have
 *  (principle 6). The story text is never read. */
import type { Category } from './ui/ui-helpers';

/** Alternatives (regex fragments, plural written out where it is wanted) -> one word-bounded pattern. "game" stays singular on purpose: "Table Top
 *  Role Playing Games Club" is not sport. */
const words = (alts: string[]) => new RegExp(String.raw`\b(?:${alts.join('|')})\b`, 'i');

const RULES: Array<[Category, RegExp]> = [
  // "board" alone is a game, not a body ("Board Games More Games" was filed as civic): it needs "board meeting" / "board of ...".
  ['civic', words(['council', 'commissions?', 'committees?', 'board meetings?', 'board of', 'hearings?', 'city hall', 'public meetings?', 'town hall', 'elections?', 'voting', 'ballots?'])],
  ['sports', words(['game', 'match(?:es)?', 'football', 'basketball', 'volleyball', 'soccer', 'baseball', 'hockey', 'tournaments?', '5k', '10k', 'marathons?', 'races?', 'run/walk', 'swim', 'golf', 'pickleball', 'jackrabbits', 'rugby', 'athletics', 'sports?'])],
  ['music', words(['concerts?', 'choirs?', 'bands?', 'orchestras?', 'symphon(?:y|ies)', 'jazz', 'music', 'musical', 'recitals?', 'singers?', 'songwriters?', 'gigs?', 'live music', 'djs?', 'carols?'])],
  ['nightlife', words(['comedy', 'stand-?up', 'karaoke', 'open mic', 'trivia', 'pub quiz', 'club nights?', 'bingo', 'drag'])],
  // Food before family (the week page's rule since 2026-10-23, now everyone's): "American Legion Family Breakfast" is a breakfast.
  ['food', words(['farmers? market', 'markets?', 'tastings?', 'dinners?', 'breakfasts?', 'brunch', 'lunch', 'suppers?', 'food', 'brew', 'beer', 'wine', 'cooking', 'bake', 'bbq', 'potlucks?', 'pancake', 'chili'])],
  ['family', words(['kids?', 'children', 'toddlers?', 'preschool', 'storytime', 'story time', 'famil(?:y|ies)', 'youth', 'teens?', 'tweens?', 'bab(?:y|ies)'])],
  ['arts', words(['arts?', 'theatre', 'theater', 'galler(?:y|ies)', 'exhibits?', 'exhibitions?', 'films?', 'movies?', 'screenings?', 'crafts?', 'painting', 'pottery', 'dance', 'ballet', 'poetry', 'reading', 'books?', 'authors?', 'museums?', 'workshops?'])],
];

/** Ticketmaster's segments (Discovery API classifications) read as they are: no keyword guess needed. "Miscellaneous"/"Undefined": none. */
const SEGMENT: Record<string, Category> = { music: 'music', sports: 'sports', 'arts & theatre': 'arts', film: 'arts' };

/** The category one text names, by the rules above in their order; null when none matches. */
export function categoryOfText(text: string | null | undefined): Category | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return null;
}

export interface CategoryInput {
  /** The source's own labels, in order (Ticketmaster: segment, then genre -- "Dance/Electronic" under Music is music; a calendar: its category). */
  source?: (string | null | undefined)[];
  title: string;
  /** The venue's name: read only when neither the source nor the title says anything. */
  venue?: string | null;
}

/** The one category function (see the module comment for the order). */
export function categorize({ source = [], title, venue = null }: CategoryInput): Category | null {
  for (const s of source) {
    const label = (s ?? '').trim();
    if (!label) continue;
    const bySegment = SEGMENT[label.toLowerCase()];
    if (bySegment) return bySegment;
    const byLabel = categoryOfText(label);
    if (byLabel) return byLabel;
  }
  return categoryOfText(title) ?? categoryOfText(venue);
}

/** Title plus one source label: the form most callers had. Same order as categorize (the label first). */
export function categoryOfEvent(title: string, sourceCategory?: string | null, venue?: string | null): Category | null {
  return categorize({ source: [sourceCategory], title, venue });
}
