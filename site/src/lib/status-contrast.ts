/** Build-time WCAG gate for the shared status colors (extends the Local Accent
 *  Identity check in accent-contrast.ts to lib/status-tokens.mjs). Throws --
 *  failing the build -- the moment any pair in any mode drops below its
 *  minimum: 4.5:1 for text pairs, 3:1 for the dot/border marker. */
import { contrastRatio } from './accent-contrast';
import { PAGE, STATUS_TOKENS, MIN_TEXT, MIN_NON_TEXT, type StatusName } from './status-tokens.mjs';

export interface ContrastFailure { mode: string; pair: string; ratio: number; min: number }

export function checkStatusContrast(
  tokens: typeof STATUS_TOKENS = STATUS_TOKENS, page: typeof PAGE = PAGE,
): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  const check = (mode: string, pair: string, a: string, b: string, min: number) => {
    const ratio = contrastRatio(a, b);
    if (ratio < min) failures.push({ mode, pair, ratio: Math.round(ratio * 100) / 100, min });
  };
  for (const [mode, statuses] of Object.entries(tokens)) {
    const p = page[mode];
    for (const [name, v] of Object.entries(statuses) as [StatusName, { marker: string; bg: string; text: string }][]) {
      check(mode, `${name}.text on ${name}.bg`, v.text, v.bg, MIN_TEXT);
      check(mode, `page ink on ${name}.bg`, p.ink, v.bg, MIN_TEXT);
      check(mode, `${name}.text on paper`, v.text, p.paper, MIN_TEXT);
      check(mode, `${name}.text on surface`, v.text, p.surface, MIN_TEXT);
      check(mode, `${name}.marker on paper`, v.marker, p.paper, MIN_NON_TEXT);
      check(mode, `${name}.marker on surface`, v.marker, p.surface, MIN_NON_TEXT);
      check(mode, `${name}.marker on ${name}.bg`, v.marker, v.bg, MIN_NON_TEXT);
    }
  }
  return failures;
}

export function assertStatusContrast(): void {
  const failures = checkStatusContrast();
  if (failures.length === 0) return;
  throw new Error(
    'Build-time status color contrast check failed:\n' +
    failures.map((f) => `  [${f.mode}] ${f.pair}: ${f.ratio}:1 < ${f.min}:1`).join('\n'),
  );
}
