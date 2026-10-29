/** Net under the public-safety notices (spec .claude/specs/public-safety.md, "Ingår inte"): these pages are about fire and air, never about
 *  crime. The notices only carry the source's own incident name and county, so this is a backstop: a notice whose text contains a crime or
 *  person word is held back from the page (and counted in the API's `held`) until the owner has looked at it. Whole words only. */
const CRIME_WORDS = [
  'arrest', 'arrested', 'charged', 'charges', 'court', 'trial', 'sentenced', 'convicted', 'victim', 'victims', 'missing', 'murder', 'homicide',
  'assault', 'stabbing', 'shooting', 'suspect', 'suspects', 'manhunt', 'wanted', 'bail', 'died', 'dead', 'death', 'killed', 'fatal', 'body',
];
const RE = new RegExp(`\\b(?:${CRIME_WORDS.join('|')})\\b`, 'i');

export function hasCrimeWord(text: string | null | undefined): boolean {
  return RE.test(String(text ?? ''));
}
