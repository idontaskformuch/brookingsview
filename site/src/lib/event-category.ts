/** One of the library's categories (colour + icon) for an event, from its TITLE and the source's own category label, or null.
 *  Rule-based and deliberately conservative: a miss shows a neutral row, a wrong guess would colour a row with a meaning it does not have
 *  (principle 6). The story text is never read. */
import type { Category } from './ui/ui-helpers';

const RULES: Array<[Category, RegExp]> = [
  ['civic', /\b(council|commission|committee|board|hearing|city hall|public meeting|town hall|election|voting|ballot)\b/i],
  ['sports', /\b(game|match|football|basketball|volleyball|soccer|baseball|hockey|tournament|5k|10k|marathon|race|run\/walk|swim|golf|pickleball|jackrabbits|rugby|athletics)\b/i],
  ['music', /\b(concert|choir|band|orchestra|symphony|jazz|music|musical|recital|singer|songwriter|gig|live music|dj|carols?)\b/i],
  ['nightlife', /\b(comedy|stand-?up|karaoke|open mic|trivia|pub quiz|club night|bingo|drag)\b/i],
  ['family', /\b(kids?|children|toddler|preschool|storytime|story time|family|families|youth|teens?|tween|baby|babies)\b/i],
  ['food', /\b(farmers? market|market|tasting|dinner|brunch|lunch|supper|food|brew|beer|wine|cooking|bake|bbq|potluck|pancake|chili)\b/i],
  ['arts', /\b(art|arts|theatre|theater|gallery|exhibit|exhibition|film|movie|screening|craft|crafts|painting|pottery|dance|ballet|poetry|reading|book|author|museum|workshop)\b/i],
];

export function categoryOfEvent(title: string, sourceCategory?: string | null): Category | null {
  const text = `${title} ${sourceCategory ?? ''}`;
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return null;
}
