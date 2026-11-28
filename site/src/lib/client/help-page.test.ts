import { describe, expect, it } from 'vitest';
import { locateVisitor } from './help-page';

// Owner 2026-11-28: the browser looks up ONLY the visitor's postcode; the cards carry their own lat/lon (scrapers/help_geocode.py).
// Response shape: postcodes.io for G51 1QH, fetched 2026-11-28 (tests/fixtures/help_geocode_2026-11-28/postcodes_io_G51_1QH.json).
describe('locateVisitor', () => {
  it('makes exactly one GET, for the visitor postcode, and reads latitude/longitude', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ status: 200, result: { postcode: 'G51 1QH', latitude: 55.849929, longitude: -4.300626 } }));
    };
    expect(await locateVisitor(' g51 1qh ', fake)).toEqual({ lat: 55.849929, lon: -4.300626 });
    expect(calls).toEqual([['https://api.postcodes.io/postcodes/G51%201QH', undefined]]);
  });
  it('null on a 404 or a network error', async () => {
    expect(await locateVisitor('G51 1QH', async () => new Response('{"status":404}', { status: 404 }))).toBeNull();
    expect(await locateVisitor('G51 1QH', async () => { throw new Error('offline'); })).toBeNull();
  });
});
