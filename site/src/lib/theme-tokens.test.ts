import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './accent-contrast';
import { PAGE, MIN_TEXT } from './status-tokens.mjs';

// BaseLayout.astro owns the palette variables. This guards that its two dark
// blocks (prefers-color-scheme and the forced data-theme="dark") are identical,
// that they agree with PAGE.dark (the values the status contrast check uses),
// and that every text color clears WCAG on the dark page in the real file.
const src = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function between(start: string, open: string): string {
  const i = src.indexOf(start);
  expect(i, `missing ${start}`).toBeGreaterThan(-1);
  const j = src.indexOf(open, i);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(j + 1, k);
  }
  throw new Error('unbalanced');
}

const forced = vars(between(':root[data-theme="dark"] {', '{'));
const mediaBlock = between('@media (prefers-color-scheme: dark) {', '{');
const media = vars(mediaBlock.slice(0, mediaBlock.indexOf('.has-accent')));
const light = vars(between(':root {\n  /* Sitewide presentation-layer pass', '{'));

describe('dark palette in BaseLayout', () => {
  it('the media-query block and the forced block are identical', () => {
    expect(media).toEqual(forced);
  });
  it('defines every variable the light palette defines', () => {
    for (const k of Object.keys(light)) {
      if (k.startsWith('--font') || k.startsWith('--measure') || k === '--worker-pulse-interactive') continue;
      expect(forced, `dark is missing ${k}`).toHaveProperty(k);
    }
  });
  it('agrees with PAGE.dark', () => {
    expect(forced['--paper']).toBe(PAGE.dark.paper);
    expect(forced['--surface']).toBe(PAGE.dark.surface);
    expect(forced['--ink']).toBe(PAGE.dark.ink);
  });
  it('text colors clear 4.5:1 on dark paper and surface', () => {
    for (const k of ['--ink', '--ink-soft', '--ink-faint', '--navy', '--accent', '--alert']) {
      for (const bg of [forced['--paper'], forced['--surface']]) {
        expect(contrastRatio(forced[k], bg), `${k} on ${bg}`).toBeGreaterThanOrEqual(MIN_TEXT);
      }
    }
  });
  it('filled controls (navy bg, surface text) and the on-accent pair stay readable', () => {
    expect(contrastRatio(forced['--surface'], forced['--navy'])).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrastRatio(forced['--on-accent'], forced['--accent'])).toBeGreaterThanOrEqual(MIN_TEXT);
  });
  it('light palette text colors still clear 4.5:1 (regression guard)', () => {
    for (const k of ['--ink', '--ink-soft', '--navy', '--accent', '--alert']) {
      expect(contrastRatio(light[k], light['--surface'])).toBeGreaterThanOrEqual(MIN_TEXT);
    }
  });
  it('ticker strip: white text on both fills', () => {
    expect(contrastRatio('#ffffff', light['--sign-bg'])).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrastRatio('#ffffff', forced['--sign-bg'])).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});
