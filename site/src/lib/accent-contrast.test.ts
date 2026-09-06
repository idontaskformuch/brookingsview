import { describe, it, expect } from 'vitest';
import { contrastRatio, assertAccentContrast } from './accent-contrast';

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('a color against itself is 1:1', () => {
    expect(contrastRatio('#3e6e88', '#3e6e88')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#124549', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#124549'), 5);
  });
});

describe('assertAccentContrast', () => {
  it('is a no-op when a town has no brand block', () => {
    expect(() => assertAccentContrast('brookings_sd', undefined)).not.toThrow();
  });

  it('passes for Broomfield\'s real configured pair', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { accent: '#2d7980', accentInk: '#124549' }),
    ).not.toThrow();
  });

  it('fails loudly, naming the town, when accentInk is too light for text', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { accent: '#2d7980', accentInk: '#cccccc' }),
    ).toThrow(/broomfield_co.*accentInk/s);
  });

  it('fails loudly when accent itself is too close to white for a non-text boundary', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { accent: '#f0f0f0', accentInk: '#124549' }),
    ).toThrow(/broomfield_co.*accent/s);
  });

  it('fails loudly when accent is too light for text on a filled surface', () => {
    // #3e9aa3 clears the 3:1 non-text bar (3.30:1) but not the 4.5:1
    // filled-surface bar (also 3.30:1, same pair) -- isolates the third check.
    expect(() =>
      assertAccentContrast('broomfield_co', { accent: '#3e9aa3', accentInk: '#124549' }),
    ).toThrow(/white text on a filled accent/);
  });
});
