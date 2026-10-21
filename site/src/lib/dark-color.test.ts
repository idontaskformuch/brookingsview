import { describe, expect, it } from 'vitest';
import { toDarkAccent } from './dark-color';
import { contrastRatio } from './accent-contrast';
import { SECTION_THEME } from './section-theme';
import { PAGE } from './status-tokens.mjs';

describe('toDarkAccent', () => {
  it('lifts every section accent to >= 4.5:1 on both dark backgrounds', () => {
    for (const t of Object.values(SECTION_THEME)) {
      const dark = toDarkAccent(t.accent);
      expect(contrastRatio(dark, PAGE.dark.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark, PAGE.dark.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps the hue family (does not turn green into grey)', () => {
    const dark = toDarkAccent('#146b36');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
  it('leaves an already light color essentially unchanged', () => {
    expect(toDarkAccent('#9bbbe3')).toBe('#9bbbe3');
  });
});
