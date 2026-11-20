/** Designsystem Fas 2 punkt 3 (owner 2026-11-20): price, capitals, doubled periods. Every value is a real one, named by where it was read:
 *  stories rows by id (read-only SELECT 2026-11-20), Ticketmaster from the Brookings What's On build of 2026-11-20 (site/dist), the
 *  /game-day/ text from the Brookings build of 2026-11-12 (scratch_tmp/after-brookings_sd). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { endSentence, formatPrice, formatPriceRange, tidyCost } from './text-hygiene';
import { displayTitle } from './evening-names';
import { badgesFor } from './tonight-cards';

describe('price: whole units, a range as "$25–159"', () => {
  it('Davina and The Vagabonds (What\'s On, Brookings): "$25.43 - $159.33" -> "$25–159"', () => {
    expect(formatPriceRange(25.43, 159.33, 'USD')).toBe('$25–159');
  });
  it('one price when both ends round to the same unit; nothing without a price', () => {
    expect(formatPriceRange(40, 40, 'USD')).toBe('$40');
    expect(formatPriceRange(null, 90, 'USD')).toBeNull();
    expect(formatPrice(30.62, 'GBP')).toBe('£31');
  });
  it('the source\'s own cost text: pennies rounded (stories 4155 "£30.62", 4234 "£7.84"), the rest as written', () => {
    expect(tidyCost('£30.62')).toBe('£31'); // story 4155
    expect(tidyCost('£7.84')).toBe('£8'); // story 4234
    expect(tidyCost('$40')).toBe('$40'); // story 4203
    expect(tidyCost('Free')).toBe('Free'); // story 4043
    expect(tidyCost('£8/ £6')).toBe('£8/ £6'); // story 4230
    expect(tidyCost('Payment required')).toBe('Payment required'); // story 4079
    expect(tidyCost('Free, drop-in, no ticket required')).toBe('Free, drop-in, no ticket required'); // story 4145
    expect(tidyCost(null)).toBeNull();
  });
  it('the evening badge rounds too (story 4155\'s £30.62 as a Ticketmaster minimum)', () => {
    expect(badgesFor({ labels: [], priceMin: 30.62, priceCurrency: 'GBP' })).toEqual([{ kind: 'price', text: '£31' }]);
  });
});

describe('capitals: a title of more than one word in capitals is re-cased; abbreviations stay', () => {
  // Ticketmaster names as listed on the What's On / Tonight builds (Brookings site/dist 2026-11-20, scratch_tmp/after-* 2026-11-12).
  it.each([
    ['NED LEDOUX', 'Ned Ledoux'],
    ['TREY LEWIS', 'Trey Lewis'],
    ['BEN BANKAS: ON THIN ICE', 'Ben Bankas: On Thin Ice'],
    ['MGMT DJ SET', 'MGMT DJ Set'],
    ['RCMS WINTER SHOWCASE', 'RCMS Winter Showcase'],
    ['NRG: VIEZE ASBAK B2B ALL NIGHT LONG', 'NRG: Vieze Asbak B2B All Night Long'],
    ['2027 PREMIUM SEASON TICKETS WAITLIST', '2027 Premium Season Tickets Waitlist'],
  ])('%s -> %s', (raw, out) => expect(displayTitle(raw)).toBe(out));
  it('one word stays as written (SWITCHFOOT, KILIMANJARO)', () => {
    expect(displayTitle('SWITCHFOOT')).toBe('SWITCHFOOT');
    expect(displayTitle('KILIMANJARO')).toBe('KILIMANJARO');
  });
  it('a mixed title is left exactly as it is (story 3335 "Moreno Valley: MAIN LIBRARY: Talk MoVal")', () => {
    expect(displayTitle('Moreno Valley: MAIN LIBRARY: Talk MoVal')).toBe('Moreno Valley: MAIN LIBRARY: Talk MoVal');
  });
  it('SDSU stays: story 4131 "SDSU Football vs Indiana State" with ONLY its title set in capitals', () => {
    expect(displayTitle('SDSU FOOTBALL VS INDIANA STATE')).toBe('SDSU Football vs Indiana State');
  });
});

describe('doubled periods: a template ends a sentence after a value that already ends with one', () => {
  it('/game-day/ (Brookings build 2026-11-12): "about 12:30 p.m." and "Tailgating starts about 9 a.m." get no second period', () => {
    expect(endSentence('about 12:30 p.m.')).toBe('about 12:30 p.m.');
    expect(endSentence('Tailgating starts about 9 a.m.')).toBe('Tailgating starts about 9 a.m.');
  });
  it('a sentence without a period gets one', () => {
    expect(endSentence('Gates open 90 minutes before kickoff')).toBe('Gates open 90 minutes before kickoff.');
  });
  it('the /game-day/ template ends both lines with endSentence (no "}</strong>." or "))}." after a clock)', () => {
    const src = readFileSync(new URL('../pages/game-day.astro', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fmtTime\(hoursBefore\([^)]*\)\)\}(<\/strong>)?\./);
  });
});

describe('QA registry (CLAUDE.md 12)', () => {
  it('logic.text-hygiene and web.double-period are registered with born_from', () => {
    const reg = JSON.parse(readFileSync(new URL('../../../qa/checks.json', import.meta.url), 'utf8')).checks as Record<string, { born_from: string }>;
    expect(reg['logic.text-hygiene']?.born_from).toBeTruthy();
    expect(reg['web.double-period']?.born_from).toBeTruthy();
  });
});
