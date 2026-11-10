import { describe, expect, it } from 'vitest';
import { footerCredits } from './footer-credits';
import glasgow from '../../../configs/glasgow.json';

const sm = (enabled?: boolean) => ({ x: { sports: { ...(enabled === undefined ? {} : { enabled }), sources: [{ adapter: 'sportmonks' }] } } });

describe('footerCredits', () => {
  it('shows nothing while sports.enabled is not true (Glasgow today: false), for every town', () => {
    expect(glasgow.sports.enabled).toBe(false);
    expect((glasgow.sports as { collect?: boolean }).collect).toBe(true); // collecting is on, showing is not
    for (const town of ['glasgow', 'brookings_sd', 'moreno_valley_ca', 'broomfield_co']) expect(footerCredits(town)).toEqual([]);
  });
  it('credits Sportmonks (text only) once sports.enabled is true and the town has a sportmonks source', () => {
    expect(footerCredits('x', sm(true))).toEqual(['Data provided by Sportmonks']);
    expect(footerCredits('glasgow', { glasgow: { ...glasgow, sports: { ...glasgow.sports, enabled: true } } })).toEqual(['Data provided by Sportmonks']);
  });
  it('enabled false, missing or not exactly true = no credit', () => {
    expect(footerCredits('x', sm(false))).toEqual([]);
    expect(footerCredits('x', sm())).toEqual([]);
    expect(footerCredits('x', { x: { sports: { enabled: 'yes', sources: [{ adapter: 'sportmonks' }] } } })).toEqual([]);
  });
  it('follows the config: no sportmonks source, no credit; two sources, one line', () => {
    expect(footerCredits('x', { x: { sports: { enabled: true, sources: [{ adapter: 'internal' }] } } })).toEqual([]);
    expect(footerCredits('x', { x: { sports: { enabled: true, sources: [{ adapter: 'sportmonks' }, { adapter: 'sportmonks' }] } } })).toEqual(['Data provided by Sportmonks']);
    expect(footerCredits('unknown')).toEqual([]);
  });
});
