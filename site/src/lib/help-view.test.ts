import { describe, expect, it } from 'vitest';
import { helpSections, postalDistrict, helpAreas, helpItemListJsonLd, sortByDistance, outcodeOrder, type HelpInput } from './help-view';
import type { HelpEntryRow } from './db';

// Rows verbatim from the live DB, read 2026-11-28 (read-only): glasgow places 308 social-bite-sauchiehall-street and 295
// glasgow-sw-foodbank-ibrox, 300 glasgow-ne-foodbank-bridgeton; moreno_valley_ca 314 salvation-army-moreno-valley (weekly),
// 317 crossword-christian-church (dated rows from "2nd and 4th Saturday"), 322 sda-moreno-valley (queued), place_roles id 1
// (Cottonwood, queued). A test that changes a field says which (CLAUDE.md rule 15).
const base = { role: null, services: null, valid_from: null, valid_to: null, lat: null, lon: null, website: null, schedule_text: null, audience_tags: null, location_note: null, area_name: null, phone: null, requirements_note: null };
const row = (r: Partial<HelpEntryRow> & { place_id: number; slug: string }): HelpEntryRow & { place_id: number } =>
  ({ ...base, key: `place:${r.slug}`, source_kind: 'official', verification_status: 'verified', verified_date: '2026-11-27', category: 'food_pantry', name: r.slug, address: null, postal_code: null, source_url: '', ...r });

const SOCIAL = row({ place_id: 308, slug: 'social-bite-sauchiehall-street', name: 'Social Bite Sauchiehall Street', category: 'meal_program', source_kind: 'operator',
  address: '10 Sauchiehall St', postal_code: 'G2 3GF', source_url: 'https://www.social-bite.co.uk/coffee-shops/glasgow/' });
const IBROX = row({ place_id: 295, slug: 'glasgow-sw-foodbank-ibrox', name: 'Glasgow SW Foodbank – Ibrox', source_kind: 'operator', address: '67 Clifford Street',
  location_note: 'Ibrox Parish Church', postal_code: 'G51 1QH', requirements_note: 'Referral voucher needed', source_url: 'https://glasgowsw.foodbank.org.uk/locations/' });
const BRIDGETON = row({ place_id: 300, slug: 'glasgow-ne-foodbank-bridgeton', name: 'Glasgow NE Foodbank – Bridgeton', source_kind: 'operator', address: '26 Queen Mary Street', location_note: 'Bridgeton St Francis in the East',
  postal_code: 'G40 3BB', area_name: 'Bridgeton', phone: '07951749373', requirements_note: 'Referral voucher needed', source_url: 'https://glasgowne.foodbank.org.uk/locations/' });
const SALVATION = row({ place_id: 314, slug: 'salvation-army-moreno-valley', name: 'Salvation Army – Moreno Valley', address: '13300 Indian St.', phone: '(951) 784-4490', postal_code: '92553', source_url: 'https://moval.gov/mymoval/food-pantries.html' });
const CROSSWORD = row({ place_id: 317, slug: 'crossword-christian-church', name: 'Crossword Christian Church', address: '21401 Box Springs Road', phone: '(951) 275-5360', postal_code: '92557', source_url: 'https://moval.gov/mymoval/food-pantries.html' });
const SDA = row({ place_id: 322, slug: 'sda-moreno-valley', name: 'SDA Moreno Valley', verification_status: 'queued', address: '12649 Indian Street', phone: '(951) 662-4857', postal_code: '92553', source_url: 'https://moval.gov/mymoval/food-pantries.html' });
const COTTONWOOD = row({ place_id: 26, slug: 'cottonwood-golf-center-banquet-facility', key: 'role:26:warm_space', name: 'Cottonwood Golf Center & Banquet Facility', category: 'park',
  role: 'warm_space', verification_status: 'queued', schedule_text: '7 a.m. – 6:30 p.m. (closed Tuesdays)', source_url: 'https://moval.org/warm/' });

const h = (place_id: number, day_of_week: number, opens: string, closes: string, valid_from: string | null = null) =>
  ({ place_id, day_of_week, opens, closes, valid_from, valid_to: valid_from, time_unknown: false });
const SOCIAL_HOURS = [1, 2, 3, 4, 5].flatMap((d) => [h(308, d, '08:30:00', '09:30:00'), ...(d === 3 ? [h(308, 3, '16:45:00', '17:45:00')] : []), h(308, d, '17:00:00', '18:00:00')]);
const glasgow: HelpInput = { entries: [SOCIAL, IBROX, BRIDGETON], hours: [...SOCIAL_HOURS, h(295, 1, '12:00:00', '14:00:00'), h(300, 4, '10:45:00', '12:45:00')], closed: [] };
const moreno: HelpInput = { entries: [SALVATION, CROSSWORD, SDA, COTTONWOOD], closed: [],
  hours: [h(314, 3, '08:00:00', '11:00:00'), ...['2026-11-28', '2026-12-12', '2026-12-26', '2027-01-09'].map((d) => h(317, 6, '10:00:00', '11:00:00', d))] };

describe('helpSections', () => {
  it('puts food pantries and meals in Food and drops what helpVisible hides (queued place, queued role)', () => {
    const s = helpSections(moreno, '2026-11-28', 'us');
    expect(s.map((x) => x.id)).toEqual(['food']);
    expect(s[0].cards.map((c) => c.key)).toEqual(['place:crossword-christian-church', 'place:salvation-army-moreno-valley']);
  });
  it('a published role is a Winter help card with its schedule text verbatim (changed: verification_status verified, services warm_space)', () => {
    const s = helpSections({ ...moreno, entries: [...moreno.entries, { ...COTTONWOOD, key: 'role:26:warm_space', verification_status: 'verified', services: ['warm_space'] }] }, '2026-11-28', 'us');
    expect(s.map((x) => x.id)).toEqual(['food', 'winter']);
    expect(s[1].cards[0].scheduleText).toBe('7 a.m. – 6:30 p.m. (closed Tuesdays)');
  });
  it('merges days with the same times and keeps weekday numbers for the today mark', () => {
    const c = helpSections(glasgow, '2026-11-28', 'gb')[0].cards.find((x) => x.key === 'place:social-bite-sauchiehall-street')!;
    expect(c.weekly.map((w) => `${w.days} ${w.time}`)).toEqual(['Mon–Fri 8:30–9:30am', 'Mon–Fri 5–6pm', 'Wed 4:45–5:45pm']);
    expect(c.openDays).toEqual([1, 2, 3, 4, 5]);
  });
  it('hours lines follow the week (Mon first), then the time: Parkhead, glasgow place 304, live rows', () => {
    const PARKHEAD = row({ place_id: 304, slug: 'glasgow-ne-foodbank-parkhead', name: 'Glasgow NE Foodbank – Parkhead', source_kind: 'operator', postal_code: 'G31 4NA' });
    const c = helpSections({ entries: [PARKHEAD], hours: [h(304, 1, '13:00:00', '15:00:00'), h(304, 3, '10:30:00', '12:30:00'), h(304, 5, '13:00:00', '15:00:00')], closed: [] }, '2026-11-28', 'gb')[0].cards[0];
    expect(c.weekly.map((w) => `${w.days} ${w.time}`)).toEqual(['Mon, Fri 1–3pm', 'Wed 10:30am–12:30pm']);
  });
  it('a dated schedule shows the next dates from today, never a passed one', () => {
    const c = helpSections(moreno, '2026-11-29', 'us')[0].cards.find((x) => x.key === 'place:crossword-christian-church')!;
    expect(c.next.map((n) => n.ymd)).toEqual(['2026-12-12', '2026-12-26', '2027-01-09']);
    expect(c.next[0].label).toBe('Sat Dec 12 · 10–11 AM');
  });
  it('card facts: district, requirements, map, source, checked', () => {
    const c = helpSections(glasgow, '2026-11-28', 'gb')[0].cards.find((x) => x.key === 'place:glasgow-sw-foodbank-ibrox')!;
    expect(c.district).toBe('G51');
    expect(c.requirements).toBe('Referral voucher needed');
    expect(c.address).toBe('67 Clifford Street, G51 1QH');
    expect(c.place).toBe('Ibrox Parish Church');
    expect(c.mapHref).toBe('https://www.google.com/maps/search/?api=1&query=67%20Clifford%20Street%2C%20G51%201QH');
    expect(c.sourceHost).toBe('glasgowsw.foodbank.org.uk');
    expect(c.checked).toBe('Checked Fri 27 Nov');
  });
  it('an empty section is left out', () => {
    expect(helpSections({ entries: [SDA], hours: [], closed: [] }, '2026-11-28', 'us')).toEqual([]);
  });
});

describe('postcode helpers', () => {
  it('a UK postcode gives its outcode, a ZIP stays a ZIP', () => {
    expect(postalDistrict('G51 1QH')).toBe('G51');
    expect(postalDistrict('92553')).toBe('92553');
    expect(postalDistrict(null)).toBeNull();
  });
  it('areas (owner 2026-11-28): always the postal district, labelled with area_name when the row has one ("G40 · Bridgeton")', () => {
    const cards = helpSections(glasgow, '2026-11-28', 'gb')[0].cards;
    expect(helpAreas(cards)).toEqual([{ key: 'G2', label: 'G2' }, { key: 'G40', label: 'G40 · Bridgeton' }, { key: 'G51', label: 'G51' }]);
    expect(cards.map((c) => [c.area, c.areaLabel])).toEqual([['G40', 'G40 · Bridgeton'], ['G51', 'G51'], ['G2', 'G2']]);
  });
  it('districts sort as G2 < G40 < G51 (number order, not text order)', () => {
    const PENILEE = row({ place_id: 296, slug: 'glasgow-sw-foodbank-penilee', name: 'Glasgow SW Foodbank – Penilee', source_kind: 'operator', postal_code: 'G52 2QE' });
    const cards = helpSections({ ...glasgow, entries: [...glasgow.entries, PENILEE] }, '2026-11-28', 'gb')[0].cards;
    expect(helpAreas(cards).map((a) => a.key)).toEqual(['G2', 'G40', 'G51', 'G52']);
  });
  it('sorts by distance from a point, places without coordinates last', () => {
    const pts = [{ key: 'a', lat: 55.85, lon: -4.31 }, { key: 'b', lat: null, lon: null }, { key: 'c', lat: 55.865, lon: -4.256 }];
    expect(sortByDistance(pts, { lat: 55.864, lon: -4.26 }).map((p) => p.key)).toEqual(['c', 'a', 'b']);
  });
  it('fallback: same outcode first, then same area letters, then the rest', () => {
    expect(outcodeOrder(['G2', 'G51', 'G40', 'G51'], 'G51 2AB')).toEqual([1, 3, 0, 2]);
  });
});

describe('ItemList JSON-LD', () => {
  it('lists the shown places by name with their address', () => {
    const ld = helpItemListJsonLd(helpSections(glasgow, '2026-11-28', 'gb'), 'Glasgow');
    expect(ld['@type']).toBe('ItemList');
    expect(ld.itemListElement[0]).toEqual({ '@type': 'ListItem', position: 1, item: { '@type': 'Place', name: 'Glasgow NE Foodbank – Bridgeton',
      address: { '@type': 'PostalAddress', streetAddress: '26 Queen Mary Street', postalCode: 'G40 3BB', addressLocality: 'Glasgow' } } });
  });
});

describe('privacy page names postcodes.io where the postcode box exists (owner 2026-11-28)', () => {
  it('the UK privacy body has the postcodes.io section, gated on help.postcodeSearch', async () => {
    const { readFileSync } = await import('node:fs');
    const { ALL_CONFIGS } = await import('./site-config');
    const body = readFileSync(new URL('../components/legal/gb/PrivacyBody.astro', import.meta.url), 'utf8');
    expect(ALL_CONFIGS.filter((c) => c.help?.postcodeSearch).every((c) => c.country === 'gb')).toBe(true);
    expect(body).toMatch(/siteConfig\.help\?\.enabled && siteConfig\.help\.postcodeSearch &&/);
    expect(body).toContain('https://postcodes.io/');
    expect(body).toMatch(/not stored/);
  });
});

describe('coordinate sources in About (attribution where the cards use them)', () => {
  it('UK postcode coordinates -> postcodes.io (OS/ONS); US coordinates -> OpenStreetMap; none -> nothing', async () => {
    const { coordinateSources } = await import('./help-view');
    // live 2026-11-28 after scrapers/help_geocode: glasgow 295 = 55.849929,-4.300626; moreno 314 = 33.928315,-117.234949
    const g = helpSections({ ...glasgow, entries: [{ ...IBROX, lat: 55.849929, lon: -4.300626 }] }, '2026-11-28', 'gb')[0].cards;
    const m = helpSections({ ...moreno, entries: [{ ...SALVATION, lat: 33.928315, lon: -117.234949 }] }, '2026-11-28', 'us')[0].cards;
    expect(coordinateSources(g).map((s) => s.name)).toEqual(['postcodes.io']);
    expect(coordinateSources(m).map((s) => s.name)).toEqual(['OpenStreetMap']);
    expect(coordinateSources(helpSections(moreno, '2026-11-28', 'us')[0].cards)).toEqual([]);
  });
});
