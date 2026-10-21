import { describe, it, expect } from 'vitest';
import { contrastRatio, assertAccentContrast } from './accent-contrast';

const BF = { accent: '#2d7980', accentInk: '#124549', accentDark: '#3897a0', accentInkDark: '#30b9c4' };

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
      assertAccentContrast('broomfield_co', { ...BF }),
    ).not.toThrow();
  });

  it('fails loudly, naming the town, when accentInk is too light for text', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { ...BF, accentInk: '#cccccc' }),
    ).toThrow(/broomfield_co.*accentInk/s);
  });

  it('fails loudly when accent itself is too close to white for a non-text boundary', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { ...BF, accent: '#f0f0f0' }),
    ).toThrow(/broomfield_co.*accent/s);
  });

  it('fails loudly when accent is too light for text on a filled surface', () => {
    // #3e9aa3 clears the 3:1 non-text bar (3.30:1) but not the 4.5:1
    // filled-surface bar (also 3.30:1, same pair) -- isolates the third check.
    expect(() =>
      assertAccentContrast('broomfield_co', { ...BF, accent: '#3e9aa3' }),
    ).toThrow(/white text on a filled accent/);
  });

  it('fails loudly when the dark-mode ink is too dark for the dark page', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { ...BF, accentInkDark: '#124549' }),
    ).toThrow(/broomfield_co.*accentInkDark/s);
  });

  it('fails loudly when the dark-mode accent is too dark for a boundary', () => {
    expect(() =>
      assertAccentContrast('broomfield_co', { ...BF, accentDark: '#2d7980' }),
    ).toThrow(/broomfield_co.*accentDark/s);
  });

  it('passes for every real town in site-config', () => {
    for (const [town, b] of Object.entries({
      brookings_sd: { accent: '#746311', accentInk: '#473d0a', accentDark: '#a08918', accentInkDark: '#c4a91c' },
      moreno_valley_ca: { accent: '#4f6b2e', accentInk: '#38491f', accentDark: '#6f9640', accentInkDark: '#8db551' },
      broomfield_co: BF,
    })) expect(() => assertAccentContrast(town, b)).not.toThrow();
  });
});
