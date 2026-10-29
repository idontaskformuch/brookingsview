import { describe, expect, it } from 'vitest';
import { buildSummary, lastSubwayTime, openAfterOneCount, plural } from './evening-summary';
import { nearestArea, normVenue, withAreas, type AreaData } from './areas';
import { GETTING_HOME } from './getting-home';
import type { OpenLateRow } from './osm-open-late';
import type { EveningEntry } from './evening-items';

const TZ = 'Europe/London';
const day = Math.round(Date.parse('2026-11-06T00:00:00Z') / 86_400_000); // a Friday in GMT

const late = (endIso: string): OpenLateRow => ({ osmId: 'node/1', name: 'X', kind: 'Bar', closing: '', website: null, start: '2026-11-06T18:00:00Z', end: endIso });

describe('summary line', () => {
  it('counts places that close after 01:00 the next morning, local time', () => {
    const rows = [late('2026-11-07T00:30:00Z'), late('2026-11-07T01:00:00Z'), late('2026-11-07T01:30:00Z'), late('2026-11-07T03:00:00Z')];
    expect(openAfterOneCount(rows, day, TZ)).toBe(2);
  });
  it('last Subway time per weekday column, null without a block', () => {
    const home = GETTING_HOME.find((h) => h.townId === 'glasgow')!;
    expect(lastSubwayTime(home, false)).toBe('23:30');
    expect(lastSubwayTime(home, true)).toBe('18:03');
    expect(lastSubwayTime(null, false)).toBeNull();
  });
  it('builds only the parts that have data', () => {
    expect(buildSummary({ count: 12, period: 'tonight', openAfterOne: 86, lastTrain: '23:30', subwayName: 'Glasgow Subway' }).map((p) => p.text))
      .toEqual(['12 things on tonight', '86 places open after 1 am', 'Last Glasgow Subway train 23:30']);
    expect(buildSummary({ count: 1, period: 'tonight', openAfterOne: 0, lastTrain: null }).map((p) => p.text)).toEqual(['1 thing on tonight']);
    expect(buildSummary({ count: 0, period: 'tonight', openAfterOne: 0, lastTrain: null })).toEqual([]);
    expect(plural(1, 'place', 'places')).toBe('1 place');
  });
});

describe('areas', () => {
  const data: AreaData = {
    attribution: 'Neighbourhoods: OSM',
    areas: [{ name: 'Merchant City', lat: 55.8587, lon: -4.2458 }, { name: 'West End', lat: 55.8750, lon: -4.2900 }],
    venues: { [normVenue('Cottiers')]: 'West End' },
  };
  const entry = (over: Partial<EveningEntry>): EveningEntry => ({ id: 'a', title: 'T', start: '2026-11-06T19:00:00Z', end: null, group: null, labels: [], venue: 'Somewhere',
    href: null, source: 'own', distanceMiles: null, driveMinutes: null, checked: '2026-11-05', ...over });
  it('nearest area within 1.2 km, none beyond', () => {
    expect(nearestArea(55.859, -4.246, data.areas)).toBe('Merchant City');
    expect(nearestArea(55.95, -4.0, data.areas)).toBeNull();
  });
  it('coordinates first, then the venue-name map, otherwise no area', () => {
    const out = withAreas([entry({ lat: 55.8588, lon: -4.2459 }), entry({ id: 'b', venue: "Cottiers" }), entry({ id: 'c', venue: 'Unknown Hall' })], data);
    expect(out.map((e) => e.area ?? null)).toEqual(['Merchant City', 'West End', null]);
    expect(withAreas([entry({})], null)[0].area).toBeUndefined();
  });
});
