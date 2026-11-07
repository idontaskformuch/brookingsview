import { describe, expect, it } from 'vitest';
import { placesFromOverpass, openLateRows, placesFromSnapshot, groupOpenLateByArea, decorateOpenLate } from './osm-open-late';

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

describe('placesFromSnapshot', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const elements = [el(1, { name: 'A', amenity: 'pub', opening_hours: '24/7', check_date: '2026-09-01' })];
  it('reads a fresh snapshot', () => {
    expect(placesFromSnapshot({ fetchedAt: '2026-10-30T11:00:00Z', elements }, now)).toHaveLength(1);
  });
  it('accepts 14 days, refuses 15', () => {
    expect(placesFromSnapshot({ fetchedAt: '2026-10-19T12:00:00Z', elements }, now)).toHaveLength(1);
    expect(placesFromSnapshot({ fetchedAt: '2026-10-18T11:00:00Z', elements }, now)).toBeNull();
  });
  it('lists only places with fresh hours: check_date <= 12 months or last edit <= 24 months, others not at all', () => {
    const mixed = [
      el(1, { name: 'Fresh Check', amenity: 'pub', opening_hours: '24/7', check_date: '2026-01-01' }),
      el(2, { name: 'Stale Check', amenity: 'pub', opening_hours: '24/7', check_date: '2025-01-01' }),
      { ...el(3, { name: 'Fresh Edit', amenity: 'bar', opening_hours: '24/7' }), timestamp: '2025-06-01T00:00:00Z' },
      { ...el(4, { name: 'Stale Edit', amenity: 'bar', opening_hours: '24/7' }), timestamp: '2024-01-01T00:00:00Z' },
      el(5, { name: 'No Dates', amenity: 'bar', opening_hours: '24/7' }),
    ];
    expect(placesFromSnapshot({ fetchedAt: '2026-10-30T11:00:00Z', elements: mixed }, now)!.map((p) => p.name)).toEqual(['Fresh Check', 'Fresh Edit']);
  });
  it('gives null (no block) when there is no snapshot or the date is unreadable', () => {
    expect(placesFromSnapshot(null, now)).toBeNull();
    expect(placesFromSnapshot({ fetchedAt: 'not a date', elements }, now)).toBeNull();
  });
});

describe('builds never call Overpass', () => {
  it('no site source file mentions the Overpass endpoint or fetches it', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url);
    const offenders = readdirSync(dir).filter((f) => /\.(ts|astro)$/.test(f) && !f.endsWith('.test.ts'))
      .filter((f) => /overpass-api|overpass\.kumi|interpreter/i.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('Open late by neighbourhood (owner 2026-10-29)', () => {
  const row = (name: string, area: string | null) => ({ osmId: `node/${name}`, name, kind: 'Pub' as const, closing: 'until 3am', website: null, start: '2026-10-29T22:00:00Z', end: '2026-10-30T03:00:00Z', area });
  it('single-place neighbourhoods and places without an area go under Elsewhere, last', () => {
    const g = groupOpenLateByArea([row('A', 'Merchant City'), row('B', null), row('C', 'Finnieston'), row('D', 'Merchant City')]);
    expect(g.map((x) => [x.area, x.rows.map((r) => r.name)])).toEqual([['Merchant City', ['A', 'D']], [null, ['B', 'C']]]);
  });
  it('keeps at most 4 per neighbourhood and 24 in all', () => {
    const many = Array.from({ length: 6 }, (_, i) => row(`M${i}`, 'Merchant City'));
    expect(groupOpenLateByArea(many)[0].rows.map((r) => r.name)).toEqual(['M0', 'M1', 'M2', 'M3']);
    const lots = Array.from({ length: 40 }, (_, i) => row(`P${i}`, i % 2 ? `Area${i >> 1}` : null));
    expect(groupOpenLateByArea(lots).flatMap((g) => g.rows)).toHaveLength(24);
  });
  it('decorateOpenLate gives the canonical spelling and the area from the static file', () => {
    const out = decorateOpenLate([row('Oran Mor', null), row('Unknown Bar', null)], 'glasgow',
      { attribution: '', areas: [], venues: {}, places: { 'oran mor': 'Hillhead' } });
    expect(out.map((r) => [r.name, r.area])).toEqual([['Òran Mór', 'Hillhead'], ['Unknown Bar', null]]);
  });
});
