/** Typed reader for data-updated.json: the day each holiday page's rows last changed (a value, a status or a
 *  source). Set by hand when a row changes; a recheck that confirms the same thing does not touch it, and the
 *  build never writes it. The same file feeds the sitemap lastmod (lastmod.mjs). */
import raw from './data-updated.json';

const TABLE = raw as Record<string, Record<string, string>>;

export function dataUpdatedOn(slug: string, townId: string): string {
  const date = TABLE[slug]?.[townId];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`data-updated.json has no date for ${slug}/${townId}`);
  return date;
}
