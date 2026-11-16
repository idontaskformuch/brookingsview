/** Whether /holidays/ is indexable (audit Fas 1, P1-4, 2026-11-16; SPEC rule 5): under HOLIDAYS_MIN_WORDS words of its own
 *  text (H1, names, dates, overview lines) the page is noindex and out of the sitemap. Measured 2026-11-16 it carried 8-24
 *  words in all four towns. The page writes the verdict for the sitemap filter in astro.config.mjs (same hand-off file
 *  pattern as lib/open-late-verdict.ts), so tag and sitemap cannot disagree. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The audit's thin-page line (01-built-pages.md avsnitt 2: indexable pages under 150 words in main). */
export const HOLIDAYS_MIN_WORDS = 150;

export const HOLIDAYS_VERDICT_FILE = '.holidays-verdict.json';

export function wordCount(texts: readonly (string | null | undefined)[]): number {
  return texts.reduce((n, t) => n + (t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0), 0);
}

export function holidaysIndexable(texts: readonly (string | null | undefined)[]): boolean {
  return wordCount(texts) >= HOLIDAYS_MIN_WORDS;
}

export function writeHolidaysVerdict(townId: string, indexable: boolean): void {
  try { writeFileSync(resolve(process.cwd(), HOLIDAYS_VERDICT_FILE), JSON.stringify({ townId, indexable })); } catch { /* read-only dist: the filter then treats the page as noindex */ }
}
