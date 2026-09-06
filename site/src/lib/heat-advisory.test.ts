import { describe, expect, it } from 'vitest';
import { computeHeatTier } from './heat-advisory';

/** Extracted from HeatAdvisoryWidget.astro (CityStatus's `worker_pulse`
 *  module reuses the exact same function, see cityStatus.test.ts) -- these
 *  cases pin the original widget's behavior so the extraction changed
 *  nothing.
 */
describe('computeHeatTier', () => {
  it('a real NWS heat alert always wins, regardless of temperature', () => {
    const r = computeHeatTier(70, ['Excessive Heat Warning']);
    expect(r.tier).toBe('high-risk');
    expect(r.label).toBe('Excessive Heat Warning');
  });

  it('a dust alert is caution tier even at a safe temperature', () => {
    const r = computeHeatTier(60, ['Blowing Dust Advisory']);
    expect(r.tier).toBe('caution');
    expect(r.label).toBe('Blowing Dust Advisory');
  });

  it('heat alert takes priority over a simultaneous dust alert', () => {
    const r = computeHeatTier(70, ['Blowing Dust Advisory', 'Excessive Heat Warning']);
    expect(r.tier).toBe('high-risk');
    expect(r.label).toBe('Excessive Heat Warning');
  });

  it('105F or above is high-risk without any alert', () => {
    const r = computeHeatTier(107, []);
    expect(r.tier).toBe('high-risk');
    expect(r.label).toBe('107°F -- high heat risk');
  });

  it('90-104F is caution without any alert', () => {
    const r = computeHeatTier(92, []);
    expect(r.tier).toBe('caution');
    expect(r.label).toBe('92°F -- use caution outdoors');
  });

  it('below 90F with no alert is safe', () => {
    const r = computeHeatTier(75, []);
    expect(r.tier).toBe('safe');
    expect(r.label).toBe('75°F -- safe conditions');
  });

  it('null temperature and no alert is safe with an honest "no advisory" label', () => {
    const r = computeHeatTier(null, []);
    expect(r.tier).toBe('safe');
    expect(r.label).toBe('No advisory in effect');
  });
});
