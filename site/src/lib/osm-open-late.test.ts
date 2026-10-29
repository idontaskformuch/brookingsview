import { afterEach, describe, expect, it, vi } from 'vitest';
import { placesFromOverpass, openLateRows, overpassQuery, getOsmPlaces, _resetOsmCacheForTests } from './osm-open-late';

const el = (id: number, tags: Record<string, string>) => ({ type: 'node', id, tags });
// 2026-10-30 is a Friday; day number = days since epoch.
const FRIDAY = Math.round(Date.UTC(2026, 9, 30) / 86_400_000);
const TZ = 'Europe/London';

describe('placesFromOverpass', () => {
  it('keeps readable named places once per name and kind', () => {
    const places = placesFromOverpass([
      el(1, { name: 'The Pub', amenity: 'pub', opening_hours: 'Mo-Su 12:00-24:00', website: 'thepub.example' }),
      { type: 'way', id: 2, tags: { name: 'The Pub', amenity: 'pub', opening_hours: 'Mo-Su 12:00-24:00' } },
      el(3, { name: 'Odd Hours', amenity: 'bar', opening_hours: 'Mo-Su sunrise-sunset' }),
      el(4, { amenity: 'bar', opening_hours: 'Mo-Su 12:00-24:00' }),
      el(5, { name: 'Cinema', amenity: 'cinema', opening_hours: 'Mo-Su 12:00-24:00' }),
    ]);
    expect(places.map((p) => p.osmId)).toEqual(['node/1']);
    expect(places[0].website).toBe('https://thepub.example/');
  });
  it('drops non-http websites', () => {
    const [p] = placesFromOverpass([el(1, { name: 'X', amenity: 'bar', opening_hours: '24/7', website: 'javascript:alert(1)' })]);
    expect(p.website).toBeNull();
  });
});

describe('openLateRows', () => {
  const places = placesFromOverpass([
    el(1, { name: 'Early Pub', amenity: 'pub', opening_hours: 'Mo-Su 12:00-23:00' }),
    el(2, { name: 'Midnight Pub', amenity: 'pub', opening_hours: 'Mo-Su 12:00-24:00' }),
    el(3, { name: 'Club', amenity: 'nightclub', opening_hours: 'Fr,Sa 22:00-03:00' }),
    el(4, { name: 'Friday Bar', amenity: 'bar', opening_hours: 'Fr 17:00-24:00' }),
  ]);
  it('lists places open past 11 pm, latest closing first, then by kind', () => {
    const rows = openLateRows(places, FRIDAY, TZ);
    expect(rows.map((r) => r.name)).toEqual(['Club', 'Friday Bar', 'Midnight Pub']);
    expect(rows[0].closing).toBe('until 3am');
  });
  it('uses the weekday of the day asked for', () => {
    expect(openLateRows(places, FRIDAY - 1, TZ).map((r) => r.name)).toEqual(['Midnight Pub']);
  });
  it('gives the instants the browser hides a row by (BST ended 25 Oct, so London = UTC)', () => {
    const club = openLateRows(places, FRIDAY, TZ)[0];
    expect(club.start).toBe('2026-10-30T22:00:00.000Z');
    expect(club.end).toBe('2026-10-31T03:00:00.000Z');
  });
  it('caps the list', () => {
    expect(openLateRows(places, FRIDAY, TZ, 2)).toHaveLength(2);
  });
});

describe('overpassQuery', () => {
  it('asks for named places with opening hours inside the radius', () => {
    const q = overpassQuery(55.8642, -4.2518, 5);
    expect(q).toContain('around:5000,55.8642,-4.2518');
    expect(q).toContain('["opening_hours"]["name"]');
  });
});

describe('getOsmPlaces', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); _resetOsmCacheForTests(); });
  it('shares one fetch per town', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [el(1, { name: 'A', amenity: 'pub', opening_hours: '24/7' })] })));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([getOsmPlaces(1, 2, 3), getOsmPlaces(1, 2, 3)]);
    expect(a).toHaveLength(1);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns an empty list, not an error, when Overpass is down', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 502 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = getOsmPlaces(9, 9, 9);
    await vi.runAllTimersAsync();
    expect(await p).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
