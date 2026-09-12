import { describe, expect, it } from 'vitest';
import { slugifyAddress, homeSalesParcelSlugFromPath, wasHomeSalesParcelEverRecorded } from './home-sales-gone';

describe('slugifyAddress', () => {
  it('mirrors site/src/lib/home-sales.ts\'s own slugifyAddress exactly', () => {
    expect(slugifyAddress('12509 Heartleaf St, Moreno Valley 92553')).toBe('12509-heartleaf-st');
  });
});

describe('homeSalesParcelSlugFromPath', () => {
  it('extracts the slug from a parcel detail path', () => {
    expect(homeSalesParcelSlugFromPath('/home-sales/12509-heartleaf-st/')).toBe('12509-heartleaf-st');
    expect(homeSalesParcelSlugFromPath('/home-sales/12509-heartleaf-st')).toBe('12509-heartleaf-st');
  });

  it('returns null for the aggregate table, archive, and ZIP facets -- never "gone"', () => {
    expect(homeSalesParcelSlugFromPath('/home-sales/')).toBeNull();
    expect(homeSalesParcelSlugFromPath('/home-sales/archive/')).toBeNull();
    expect(homeSalesParcelSlugFromPath('/home-sales/zip/')).toBeNull();
  });

  it('returns null for an unrelated path', () => {
    expect(homeSalesParcelSlugFromPath('/facilities/city-hall/')).toBeNull();
    expect(homeSalesParcelSlugFromPath('/home-sales')).toBeNull();
  });
});

describe('wasHomeSalesParcelEverRecorded', () => {
  const fakeRows = [
    { address: '12509 Heartleaf St, Moreno Valley 92553' },
    { address: '23906 Lake Vista Rd, Moreno Valley 92557' },
    { address: null },
  ];
  const querySales = async () => fakeRows;

  it('returns true for a slug that matches a recorded address, even one now outside the window', async () => {
    await expect(wasHomeSalesParcelEverRecorded('12509-heartleaf-st', 'moreno_valley_ca', querySales))
      .resolves.toBe(true);
  });

  it('returns false for a slug that was never recorded at all -- a genuine 404', async () => {
    await expect(wasHomeSalesParcelEverRecorded('999-nonexistent-ave', 'moreno_valley_ca', querySales))
      .resolves.toBe(false);
  });

  it('tolerates a null address without crashing', async () => {
    await expect(wasHomeSalesParcelEverRecorded('anything', 'moreno_valley_ca', querySales)).resolves.toBe(false);
  });
});
