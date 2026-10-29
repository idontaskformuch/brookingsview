import { describe, it, expect } from 'vitest';
import { canonicalVenue, displayTitle, isAllCaps, buildVenueIndex } from './evening-names';

describe('canonicalVenue', () => {
  it('one spelling for Òran Mór whatever the source wrote (Q3 2026-10-29)', () => {
    for (const v of ['Oran Mor', 'Òran Mór', 'oran mor', 'Oran Mor Auditorium', 'ORAN MOR']) expect(canonicalVenue(v, 'glasgow')).toBe('Òran Mór');
  });
  it('is per town and leaves unknown venues as written (whitespace tidied)', () => {
    expect(canonicalVenue('Oran Mor', 'broomfield_co')).toBe('Oran Mor');
    expect(canonicalVenue('  Stereo ', 'glasgow')).toBe('Stereo');
    expect(canonicalVenue(null, 'glasgow')).toBeNull();
  });
  it('ignores a leading The and punctuation', () => {
    const idx = buildVenueIndex({ 'The Mackintosh Church': ['Mackintosh Church'] });
    expect(canonicalVenue('Mackintosh-Church', 'x', idx)).toBe('The Mackintosh Church');
  });
});

describe('displayTitle', () => {
  it('re-cases a title in capitals and keeps known abbreviations', () => {
    expect(displayTitle('MAMA TERRA')).toBe('Mama Terra');
    expect(displayTitle('OVO HYDRO TOUR')).toBe('OVO Hydro Tour');
    expect(displayTitle('DJ SET AT THE CLUB')).toBe('DJ Set at the Club');
    expect(displayTitle("O'NEILLS QUIZ")).toBe("O'Neills Quiz");
  });
  it('leaves mixed-case titles and short or digit titles alone', () => {
    expect(displayTitle('PRTY x HSSH: HRDR present CADZOW (ALL NIGHT LONG)')).toBe('PRTY x HSSH: HRDR present CADZOW (ALL NIGHT LONG)');
    expect(displayTitle('Teddy Swims')).toBe('Teddy Swims');
    expect(isAllCaps('U2')).toBe(false);
    expect(displayTitle('2PM LIVE')).toBe('2PM Live');
  });
});
