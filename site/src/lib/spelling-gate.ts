/**
 * Spelling gate (Glasgow Phase 1). A town's country decides which English its
 * static copy must use: `us` towns American, `gb` towns British. The gate is
 * symmetric -- it flags the OTHER country's spelling. Used by
 * american-spelling.test.ts (source scan) and by the build check for gb towns.
 * Proper nouns that really are spelled the other way (a venue called "Theatre")
 * are deliberately not in the lists.
 */
import type { CountryProfile } from './country-profile';

/** British spellings that must not appear in American copy. */
export const BRITISH_SPELLINGS =
  /\b(organis\w*|summaris\w*|recognis\w*|customis\w*|specialis\w*|apologis\w*|colour\w*|neighbour\w*|favourite\w*|behaviour\w*|honour\w*|labour\w*|harbour\w*|flavour\w*|centre\w*|metre\w*|litre\w*|fibre\w*)\b/i;

/** American spellings that must not appear in British copy. */
export const AMERICAN_SPELLINGS =
  /\b(organiz\w*|summariz\w*|recogniz\w*|customiz\w*|specializ\w*|apologiz\w*|prioritiz\w*|colors?|colored|coloring|colorful|colorless|neighbor\w*|favorite\w*|behavior\w*|honor(s|ed|ing)?|labor(s|ed|ing)?|harbor\w*|flavor\w*|centers?|centered|centering|meters?|liters?|fibers?|theaters?|defense|offense|canceled|canceling|traveler\w*|catalog(s|ed)?)\b/i;

/** The forbidden pattern for copy written for `spelling`. */
export function forbiddenSpellingFor(spelling: CountryProfile['spelling']): RegExp {
  return spelling === 'american' ? BRITISH_SPELLINGS : AMERICAN_SPELLINGS;
}

/** All violations of `spelling` in `text` (one entry per matching word). */
export function findSpellingViolations(text: string, spelling: CountryProfile['spelling']): string[] {
  const rx = new RegExp(forbiddenSpellingFor(spelling).source, 'gi');
  return [...text.matchAll(rx)].map((m) => m[0]);
}
