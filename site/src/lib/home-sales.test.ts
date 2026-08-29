import { describe, expect, it } from 'vitest';
import {
  OUTLIER_PRICE_FLOOR, isOutlierSale, titleCaseAddress, extractZip, slugifyAddress, digestSlugForSaleDate,
} from './home-sales';
import { formatPrice } from './db';

describe('formatPrice with a numeric string (real DB driver behavior)', () => {
  // Real bug, caught by inspecting an actual built page: Postgres NUMERIC
  // columns (sale_price, salary_min/max, ...) come back from the neon
  // serverless driver as JS strings, not numbers, despite the TypeScript
  // types claiming `number` -- confirmed live: a real property page
  // rendered "$620000" instead of "$620,000". `value.toLocaleString()`
  // silently no-ops on a string (String.prototype.toLocaleString ignores
  // its formatting arguments), so any code that calls .toLocaleString()
  // directly on a DB-sourced "number" field has this bug; formatPrice()
  // (already used correctly by jobs.astro's salary display) uses
  // Intl.NumberFormat().format(), which DOES coerce a numeric string --
  // this test pins that behavior so a future refactor can't silently
  // regress it back to the broken pattern.
  it('formats a numeric string with commas, not verbatim', () => {
    // @ts-expect-error -- deliberately passing what the DB driver actually returns
    expect(formatPrice('620000')).toBe('$620,000');
  });
  it('formats a real number the same way', () => {
    expect(formatPrice(620000)).toBe('$620,000');
  });
});

describe('isOutlierSale', () => {
  it('flags a sub-threshold sale', () => {
    expect(isOutlierSale(500)).toBe(true);
    expect(isOutlierSale(OUTLIER_PRICE_FLOOR - 1)).toBe(true);
  });
  it('does not flag a real market sale', () => {
    expect(isOutlierSale(OUTLIER_PRICE_FLOOR)).toBe(false);
    expect(isOutlierSale(450_000)).toBe(false);
  });
  it('does not flag null or zero', () => {
    expect(isOutlierSale(null)).toBe(false);
    expect(isOutlierSale(0)).toBe(false);
  });
});

describe('titleCaseAddress', () => {
  it('title-cases an ALL-CAPS address', () => {
    expect(titleCaseAddress('10426 SPARROW CT, MORENO VALLEY 92557')).toBe('10426 Sparrow Ct, Moreno Valley 92557');
  });
  it('leaves an already-mixed-case address correctly cased', () => {
    expect(titleCaseAddress('10426 Sparrow CT, Moreno Valley 92557')).toBe('10426 Sparrow Ct, Moreno Valley 92557');
  });
  it('handles null', () => {
    expect(titleCaseAddress(null)).toBe('—');
  });
});

describe('extractZip', () => {
  it('pulls the trailing 5-digit ZIP', () => {
    expect(extractZip('15601 LASSELLE ST #10, MORENO VALLEY 92551')).toBe('92551');
  });
  it('returns empty string when no ZIP is present', () => {
    expect(extractZip('15601 LASSELLE ST')).toBe('');
    expect(extractZip(null)).toBe('');
  });
});

describe('slugifyAddress', () => {
  it('drops the city/ZIP tail and hyphenates the street address', () => {
    expect(slugifyAddress('15601 LASSELLE ST #10, MORENO VALLEY 92551')).toBe('15601-lasselle-st-10');
  });
  it('is case-insensitive and collapses punctuation', () => {
    expect(slugifyAddress('10426 Sparrow CT, Moreno Valley 92557')).toBe('10426-sparrow-ct');
  });
  it('two real addresses that differ only by unit number stay distinct', () => {
    expect(slugifyAddress('15601 LASSELLE ST #10, MORENO VALLEY 92551'))
      .not.toBe(slugifyAddress('15601 LASSELLE ST #12, MORENO VALLEY 92551'));
  });
});

describe('digestSlugForSaleDate', () => {
  it('matches the Python pipeline\'s slug format exactly', () => {
    expect(digestSlugForSaleDate('2026-08-19')).toBe('home-sales-digest-2026-08');
  });
  it('zero-pads single-digit months', () => {
    expect(digestSlugForSaleDate('2026-03-05')).toBe('home-sales-digest-2026-03');
  });
});
