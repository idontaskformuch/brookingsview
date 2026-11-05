import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './accent-contrast';
import { MIN_TEXT } from './status-tokens.mjs';

const css = readFileSync(new URL('../design/ui-tokens.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layout = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function block(start: string): string {
  const i = css.indexOf(start);
  expect(i, `missing ${start}`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('\n  }', i) > -1 && start.includes(':not') ? css.indexOf('\n  }', i) : css.indexOf('\n}', i));
}
const light = vars(block(':root {'));
const media = vars(block(':root:not([data-theme="light"]) {'));
const forced = vars(block(':root[data-theme="dark"] {'));
const cats = ['--cat-civic', '--cat-music', '--cat-family', '--cat-sports', '--cat-food', '--cat-arts'];
const temps = ['--temp-1', '--temp-2', '--temp-3', '--temp-4', '--temp-5', '--temp-6'];

describe('ui-tokens.css', () => {
  it('has exactly six category colors', () => {
    expect(Object.keys(light).filter((k) => k.startsWith('--cat-'))).toEqual(cats);
  });
  it('dark media block and forced block are identical', () => {
    expect(media).toEqual(forced);
  });
  it('dark overrides every category and temperature color', () => {
    for (const k of [...cats, ...temps]) expect(forced).toHaveProperty(k);
  });
  it.each([
    ['light', light, '#fbfaf7', '#ffffff'],
    ['dark', forced, '#121210', '#1c1c19'],
  ])('category colors clear 4.5:1 on %s paper and surface', (_m, v, paper, surface) => {
    for (const k of cats) {
      for (const bg of [paper, surface]) {
        expect(contrastRatio(v[k], bg), `${k} on ${bg}`).toBeGreaterThanOrEqual(MIN_TEXT);
      }
    }
  });
  it('BaseLayout no longer loads or uses a monospace face for data', () => {
    expect(layout).not.toMatch(/IBM\+Plex|IBM Plex/);
    expect(layout).toMatch(/--font-data:\s*var\(--font-ui\)/);
  });
});
