import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './accent-contrast';
import { MIN_TEXT } from './status-tokens.mjs';
import { CATEGORY_SETS } from './ui/ui-helpers';

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
const cats = ['--cat-civic', '--cat-music', '--cat-family', '--cat-sports', '--cat-food', '--cat-arts', '--cat-nightlife'];
const temps = ['--temp-1', '--temp-2', '--temp-3', '--temp-4', '--temp-5', '--temp-6'];

describe('ui-tokens.css', () => {
  it('defines the category colors, and no page type uses more than six', () => {
    expect(Object.keys(light).filter((k) => k.startsWith('--cat-'))).toEqual(cats);
    for (const [page, set] of Object.entries(CATEGORY_SETS)) expect(set.length, page).toBeLessThanOrEqual(6);
  });
  it('the hero is sized to dominate at 390 px', () => {
    expect(light['--ui-hero']).toBe('clamp(3.5rem, 16vw, 5.5rem)');
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
  it('--surface-raised is a step lighter than the page in dark, white in light, and dark cards carry no border', () => {
    expect(light['--surface-raised']).toBe('#ffffff');
    expect(light['--card-border-w']).toBe('1px');
    expect(forced['--surface-raised']).toBe('#1f1f1b');
    expect(forced['--card-border-w']).toBe('0px');
    const lum = (hex: string) => contrastRatio(hex, '#000000');
    expect(lum(forced['--surface-raised'])).toBeGreaterThan(lum('#121210'));
  });
  it.each([
    ['light', light, '#ffffff'],
    ['dark', forced, '#1f1f1b'],
  ])('text on --surface-raised clears 4.5:1 in %s: ink, ink-soft, the six events categories', (_m, v, surface) => {
    const base = _m === 'light' ? { ink: '#161614', soft: '#55554f' } : { ink: '#ece9e1', soft: '#b8b5ab' };
    expect(contrastRatio(base.ink, surface)).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrastRatio(base.soft, surface)).toBeGreaterThanOrEqual(MIN_TEXT);
    for (const c of CATEGORY_SETS.events) expect(contrastRatio(v[`--cat-${c}`], surface), `${c}`).toBeGreaterThanOrEqual(MIN_TEXT);
  });
  it('per town: the "Today / In N days" label (accent ink) clears 4.5:1 and the large date number (accent) clears 3:1 on --surface-raised, light and dark', () => {
    const brands = [...readFileSync(new URL('./site-config.ts', import.meta.url), 'utf8').matchAll(/brand: \{ accent: '(#\w+)', accentInk: '(#\w+)', accentDark: '(#\w+)', accentInkDark: '(#\w+)' \}/g)];
    expect(brands.length).toBe(4);
    for (const [, accent, ink, accentDark, inkDark] of brands) {
      expect(contrastRatio(ink, '#ffffff'), `label ${ink} light`).toBeGreaterThanOrEqual(MIN_TEXT);
      expect(contrastRatio(inkDark, '#1f1f1b'), `label ${inkDark} dark`).toBeGreaterThanOrEqual(MIN_TEXT);
      expect(contrastRatio(accent, '#ffffff'), `number ${accent} light`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(accentDark, '#1f1f1b'), `number ${accentDark} dark`).toBeGreaterThanOrEqual(3);
    }
  });
  it('BaseLayout no longer loads or uses a monospace face for data', () => {
    expect(layout).not.toMatch(/IBM\+Plex|IBM Plex/);
    expect(layout).toMatch(/--font-data:\s*var\(--font-ui\)/);
  });
});
