/** One of the library's categories (colour + icon) for an event, from its TITLE and the source's own category label, or null.
 *  Rule-based and deliberately conservative: a miss shows a neutral row, a wrong guess would colour a row with a meaning it does not have
 *  (principle 6). The story text is never read. */
import type { Category } from './ui/ui-helpers';

/** Alternatives (regex fragments, plural written out where it is wanted) -> one word-bounded pattern. "game" stays singular on purpose: "Table Top
 *  Role Playing Games Club" is not sport. */
const words = (alts: string[]) => new RegExp(String.raw`\b(?:${alts.join('|')})\b`, 'i');

const RULES: Array<[Category, RegExp]> = [
  // "board" alone is a game, not a body ("Board Games More Games" was filed as civic): it needs "board meeting" / "board of ...".
  ['civic', words(['council', 'commissions?', 'committees?', 'board meetings?', 'board of', 'hearings?', 'city hall', 'public meetings?', 'town hall', 'elections?', 'voting', 'ballots?'])],
  ['sports', words(['game', 'match(?:es)?', 'football', 'basketball', 'volleyball', 'soccer', 'baseball', 'hockey', 'tournaments?', '5k', '10k', 'marathons?', 'races?', 'run/walk', 'swim', 'golf', 'pickleball', 'jackrabbits', 'rugby', 'athletics'])],
  ['music', words(['concerts?', 'choirs?', 'bands?', 'orchestras?', 'symphon(?:y|ies)', 'jazz', 'music', 'musical', 'recitals?', 'singers?', 'songwriters?', 'gigs?', 'live music', 'djs?', 'carols?'])],
  ['nightlife', words(['comedy', 'stand-?up', 'karaoke', 'open mic', 'trivia', 'pub quiz', 'club nights?', 'bingo', 'drag'])],
  ['family', words(['kids?', 'children', 'toddlers?', 'preschool', 'storytime', 'story time', 'famil(?:y|ies)', 'youth', 'teens?', 'tweens?', 'bab(?:y|ies)'])],
  ['food', words(['farmers? market', 'markets?', 'tastings?', 'dinners?', 'brunch', 'lunch', 'suppers?', 'food', 'brew', 'beer', 'wine', 'cooking', 'bake', 'bbq', 'potlucks?', 'pancake', 'chili'])],
  ['arts', words(['arts?', 'theatre', 'theater', 'galler(?:y|ies)', 'exhibits?', 'exhibitions?', 'films?', 'movies?', 'screenings?', 'crafts?', 'painting', 'pottery', 'dance', 'ballet', 'poetry', 'reading', 'books?', 'authors?', 'museums?', 'workshops?'])],
];

export function categoryOfEvent(title: string, sourceCategory?: string | null): Category | null {
  const text = `${title} ${sourceCategory ?? ''}`;
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return null;
}
