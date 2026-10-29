import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';

const byTown = (id: string) => ALL_CONFIGS.find((c) => c.townId === id)!;

/** Owner 2026-10-29 (T1): per-town radius and whether Ticketmaster sport counts. */
describe('eveningLayer config per town', () => {
  const expected: Record<string, [number, boolean]> = {
    glasgow: [15, true], broomfield_co: [20, true], moreno_valley_ca: [35, true], brookings_sd: [75, false],
  };
  for (const [town, [miles, sport]] of Object.entries(expected)) {
    it(`${town}: ${miles} miles, Ticketmaster sport ${sport}`, () => {
      expect(byTown(town).eveningLayer).toMatchObject({ maxMiles: miles, includeTicketmasterSports: sport });
    });
  }
  it('has an Open late query only where OpenStreetMap has hours mapped (t1-report.md)', () => {
    const withBlock = ALL_CONFIGS.filter((c) => c.eveningLayer?.openLate).map((c) => c.townId).sort();
    expect(withBlock).toEqual(['broomfield_co', 'glasgow']);
  });
  it('reads the venue register only where configs/<town>.json lists venues', () => {
    const withRegister = ALL_CONFIGS.filter((c) => c.eveningLayer?.register).map((c) => c.townId).sort();
    expect(withRegister).toEqual(['broomfield_co', 'glasgow']);
  });
  it('never looks further than the Ticketmaster fetch radius', () => {
    for (const c of ALL_CONFIGS) if (c.eveningLayer && c.ticketmaster) expect(c.eveningLayer.maxMiles).toBeLessThanOrEqual(c.ticketmaster.radiusMiles);
  });
});
