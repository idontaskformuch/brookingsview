import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLOSES_SOON_MS, OPEN_TONIGHT_GROUP_MAX, groupByClosing, groupLabelOf, kindChips, rowHref, rowMeta } from './open-tonight-list';
import { applyGroup, type OtlGroup, type OtlRow } from './client/open-tonight-list';
import type { OpenLateRow } from './osm-open-late';

// Real rows: Glasgow /today/ built 2026-11-24T23:21Z (Open tonight for Tue 24 Nov), name/kind/area/closing/website/start/end verbatim.
// OSM ids of Bloc+ and Calabash read from osm_places (town glasgow) the same night; the other ids are not used by any assertion.
const r = (name: string, kind: OpenLateRow['kind'], area: string | null, closing: string, website: string | null, start: string, end: string, osmId = 'node/0'): OpenLateRow =>
  ({ osmId, name, kind, area, closing, website, start, end });
const BLOC = r('Bloc+', 'Bar', 'Blythswood Hill', 'Open until 03:00', 'https://www.bloc.ru/', '2026-11-24T11:00:00.000Z', '2026-11-25T03:00:00.000Z', 'node/2318541886');
const ORAN = r('Òran Mór', 'Pub', 'Hillhead', 'Open until 02:00', 'https://oran-mor.co.uk/bars/whisky-bar/', '2026-11-24T09:00:00.000Z', '2026-11-25T02:00:00.000Z');
const KEBAB = r('German Doner Kebab', 'Restaurant', 'Yorkhill', 'Open until 02:00', 'https://www.germandonerkebab.com/', '2026-11-24T11:00:00.000Z', '2026-11-25T02:00:00.000Z');
const CALABASH = r('Calabash African Restaurant', 'Restaurant', 'Blythswood Holm', 'Open until 01:00', null, '2026-11-24T12:00:00.000Z', '2026-11-25T01:00:00.000Z', 'node/2316968777');
const STRAV = r('Stravaigin', 'Restaurant', 'Park District', 'Open until 01:00', 'https://www.stravaigin.co.uk/', '2026-11-24T10:00:00.000Z', '2026-11-25T01:00:00.000Z');
const BANK = r('Bank Street', 'Pub', 'Hillhead', 'Open until 01:00', 'https://bankst.co.uk/', '2026-11-24T10:00:00.000Z', '2026-11-25T01:00:00.000Z');
const MIDNIGHT: OpenLateRow[] = [
  r('Avant Garde', 'Bar', 'Glasgow Cross', 'Open until 00:00', 'http://avantgardemusicbar.co.uk/', '2026-11-24T11:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Brel', 'Bar', 'Hillhead', 'Open until 00:00', 'https://www.brelbar.com/', '2026-11-24T11:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r("Chinaski's", 'Bar', 'Sandyford', 'Open until 00:00', 'https://chinaskis.co.uk/', '2026-11-24T12:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Cottiers', 'Bar', 'Dowanhill', 'Open until 00:00', 'https://cottiers.com/', '2026-11-24T11:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Drury Street Bar & Kitchen', 'Bar', 'City Centre', 'Open until 00:00', null, '2026-11-24T12:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Flight Club', 'Bar', 'City Centre', 'Open until 00:00', null, '2026-11-24T11:30:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Innis & Gunn Brewery Taproom Glasgow City Centre', 'Bar', 'City Centre', 'Open until 00:00', 'https://www.innisandgunn.com/row/taprooms/glasgow/city-centre', '2026-11-24T12:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r("Reardon's", 'Bar', null, 'Open until 00:00', 'https://reardonsnookerandpool.com/central/', '2026-11-24T10:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Super Bario', 'Bar', 'Glasgow Cross', 'Open until 00:00', null, '2026-11-24T12:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('The Underground', 'Bar', 'Merchant City', 'Open until 00:00', null, '2026-11-24T18:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  r('Babbity Bowster', 'Pub', 'Merchant City', 'Open until 00:00', 'https://babbitybowster.com/', '2026-11-24T12:00:00.000Z', '2026-11-25T00:00:00.000Z'),
];
const ROWS = [BLOC, ORAN, KEBAB, BANK, CALABASH, STRAV, ...MIDNIGHT];

describe('groups by closing time, time in the heading (owner 2026-11-25)', () => {
  it('"Until 03:00" ... "Until midnight", latest first, never "Open until" in a heading', () => {
    const g = groupByClosing(ROWS);
    expect(g.map((x) => x.label)).toEqual(['Until 03:00', 'Until 02:00', 'Until 01:00', 'Until midnight']);
    expect(g.map((x) => x.rows.length)).toEqual([1, 2, 3, 11]);
    expect(g.map((x) => x.key)).toEqual(['until-03-00', 'until-02-00', 'until-01-00', 'until-midnight']);
  });
  it('a row without a trusted closing time goes under "Open late"; 24 hours keeps its words', () => {
    expect(groupLabelOf('')).toBe('Open late');
    expect(groupLabelOf('Open 24 hours')).toBe('Open 24 hours');
  });
});

describe('rows', () => {
  it('line 2 is kind · area (kind alone without an area)', () => {
    expect(rowMeta(BLOC)).toBe('Bar · Blythswood Hill');
    expect(rowMeta(MIDNIGHT[7])).toBe('Bar');
  });
  it('the row links to the website, else to the place on OpenStreetMap', () => {
    expect(rowHref(BLOC)).toBe('https://www.bloc.ru/');
    expect(rowHref(CALABASH)).toBe('https://www.openstreetmap.org/node/2316968777');
  });
  it('chips: only kinds in the data, owner order, design-system minimum (>= 3 each, >= 2 chips)', () => {
    expect(kindChips(ROWS)).toEqual(['Bars', 'Pubs', 'Restaurants']);
    expect(kindChips([BLOC, ...MIDNIGHT.slice(0, 3)])).toEqual([]); // one kind only: no chip row
  });
});

/** The smallest group the client needs: rows with a dataset, `hidden`, a class list and a "closes soon" slot; a "Show all" button. */
function rowEl(row: OpenLateRow) {
  const classes = new Set<string>();
  const soon = { hidden: true };
  const el: OtlRow = {
    dataset: { end: row.end, kind: { Bar: 'Bars', Pub: 'Pubs', Restaurant: 'Restaurants' }[row.kind as 'Bar'] },
    hidden: false,
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    querySelector: () => soon,
  };
  return { el, classes, soon };
}
function groupOf(rows: ReturnType<typeof rowEl>[]) {
  const btn = { hidden: true, textContent: '' as string | null };
  const g: OtlGroup = { dataset: {}, hidden: false, querySelectorAll: () => rows.map((x) => x.el), querySelector: () => btn };
  return { g, btn };
}

describe('the browser (lib/client/open-tonight-list.ts)', () => {
  it('at most 8 per group, then "Show all (N)"; opened, every row shows', () => {
    const rows = MIDNIGHT.map(rowEl);
    const { g, btn } = groupOf(rows);
    const at2300 = Date.parse('2026-11-24T23:00:00Z');
    expect(applyGroup(g, at2300, '', false)).toBe(11);
    expect(rows.filter((x) => x.classes.has('otl-row--more')).length).toBe(11 - OPEN_TONIGHT_GROUP_MAX);
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('Show all (11)');
    applyGroup(g, at2300, '', true);
    expect(rows.some((x) => x.classes.has('otl-row--more'))).toBe(false);
    expect(btn.hidden).toBe(true);
  });
  it('"closes soon" under an hour before closing, and a closed place goes (the group with it)', () => {
    const rows = [BANK, CALABASH].map(rowEl);
    const { g } = groupOf(rows);
    applyGroup(g, Date.parse('2026-11-25T00:30:00Z'), '', false); // 00:30 in Glasgow, the 01:00 group
    expect(rows.every((x) => !x.soon.hidden)).toBe(true);
    applyGroup(g, Date.parse('2026-11-24T23:59:00Z'), '', false);
    expect(rows.every((x) => x.soon.hidden)).toBe(true);
    expect(CLOSES_SOON_MS).toBe(3_600_000);
    applyGroup(g, Date.parse('2026-11-25T01:00:00Z'), '', false);
    expect(rows.every((x) => x.classes.has('otl-row--closed'))).toBe(true);
    expect(g.hidden).toBe(true);
  });
  it('a kind chip keeps only that kind and never touches `hidden` (that is /tonight\'s area filter)', () => {
    const rows = [ORAN, KEBAB].map(rowEl);
    const { g } = groupOf(rows);
    expect(applyGroup(g, Date.parse('2026-11-24T23:00:00Z'), 'Pubs', false)).toBe(1);
    expect(rows[1].classes.has('otl-row--off')).toBe(true);
    expect(rows.every((x) => x.el.hidden === false)).toBe(true);
  });
});

describe('one component for /today and /tonight', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('both pages render components/OpenTonightList.astro; no row says "Open until"', () => {
    expect(read('../components/OpenTonight.astro')).toContain('<OpenTonightList');
    expect(read('../components/tonight/TonightRows.astro')).toContain('<OpenTonightList');
    const list = read('../components/OpenTonightList.astro');
    expect(list).not.toContain('closing}');
    expect(list).toMatch(/\.otl-row__name, \.otl-row__meta \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis/);
  });
});
