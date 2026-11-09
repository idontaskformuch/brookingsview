/** Name and colour token of the dot on an event row. Only the categories in CATEGORY_SETS.events get a colour (six, so the list never shows more
 *  than six); a category outside that set keeps its name with the neutral dot, which is honest about it not being one of the page's colours. */
import { CATEGORY_SETS, type Category } from './ui/ui-helpers';

const NAME: Record<Category, string> = { civic: 'Civic', music: 'Music', family: 'Family', sports: 'Sports', food: 'Food', arts: 'Arts', nightlife: 'Nightlife' };

export function popCategory(cat: Category | null | undefined): { name: string | null; token: string | null } {
  if (!cat) return { name: null, token: null };
  return { name: NAME[cat], token: (CATEGORY_SETS.events as readonly string[]).includes(cat) ? `--cat-${cat}` : null };
}
