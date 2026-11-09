import { describe, expect, it } from 'vitest';
import { footerCredits } from './footer-credits';

describe('footerCredits', () => {
  it('Glasgow credits Sportmonks (text only); the other towns show nothing', () => {
    expect(footerCredits('glasgow')).toEqual(['Data provided by Sportmonks']);
    for (const town of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co']) expect(footerCredits(town)).toEqual([]);
  });
  it('follows the config: no sportmonks source, no credit; two sources, one line', () => {
    expect(footerCredits('x', { x: { sports: { sources: [{ adapter: 'internal' }] } } })).toEqual([]);
    expect(footerCredits('x', { x: { sports: { sources: [{ adapter: 'sportmonks' }, { adapter: 'sportmonks' }] } } })).toEqual(['Data provided by Sportmonks']);
    expect(footerCredits('unknown')).toEqual([]);
  });
});
