/** The row label of each library category. Its own module, with no imports but a type, so browser code (lib/today-buckets.ts via
 *  lib/day-digest.ts) can name a category without pulling in the server-side row builders. lib/event-row.ts re-exports it. */
import type { Category } from './ui/ui-helpers';

export const CATEGORY_LABEL: Record<Category, string> = {
  civic: 'Civic', music: 'Music', family: 'Family', sports: 'Sports', food: 'Food & drink', arts: 'Arts', nightlife: 'Nightlife',
};
