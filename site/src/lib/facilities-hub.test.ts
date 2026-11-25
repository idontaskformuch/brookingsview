import { describe, expect, it } from 'vitest';
import { hubPromisesHours, parkAmenities, shortAddress, weeklyHoursLine } from './facilities-hub';
import type { StructuredHours } from './db';
import { rowsFromWeek } from './hours-spec';

// Every value below is copied from a real places row (town_id / slug named per case), read 2026-11-25.

// brookings_sd / public-library
const BROOKINGS_LIBRARY: StructuredHours = {
  monday: ['09:30', '20:00'], tuesday: ['09:30', '20:00'], wednesday: ['09:30', '20:00'], thursday: ['09:30', '20:00'],
  friday: ['09:30', '17:30'], saturday: ['09:30', '17:30'], sunday: ['13:00', '17:00'],
};
// brookings_sd / city-hall
const BROOKINGS_CITY_HALL: StructuredHours = {
  monday: ['08:00', '17:00'], tuesday: ['08:00', '17:00'], wednesday: ['08:00', '17:00'], thursday: ['08:00', '17:00'],
  friday: ['08:00', '12:00'], saturday: null, sunday: null,
};

describe('weeklyHoursLine: the hub row says the week, from the same structured hours as the pill', () => {
  it('joins days with the same window (brookings_sd/public-library)', () => {
    expect(weeklyHoursLine(rowsFromWeek(BROOKINGS_LIBRARY))).toBe('Mon–Thu 9:30am–8pm, Fri–Sat 9:30am–5:30pm, Sun 1pm–5pm');
  });
  it('leaves closed days out (brookings_sd/city-hall)', () => {
    expect(weeklyHoursLine(rowsFromWeek(BROOKINGS_CITY_HALL))).toBe('Mon–Thu 8am–5pm, Fri 8am–noon');
  });
  it('the same window every day is "Daily" (brookings_sd/dakota-nature-park)', () => {
    const w: [string, string] = ['06:00', '23:00'];
    expect(weeklyHoursLine(rowsFromWeek({ monday: w, tuesday: w, wednesday: w, thursday: w, friday: w, saturday: w, sunday: w }))).toBe('Daily 6am–11pm');
  });
  it('no hours, no line', () => {
    expect(weeklyHoursLine(null)).toBeNull();
  });
});

describe('hubPromisesHours: the heading promises hours only when most places have them', () => {
  const withHours = { hasHours: true };
  const without = { hasHours: false };
  it('brookings_sd: 3 of 40 public places have hours -> no promise', () => {
    expect(hubPromisesHours([...Array(3).fill(withHours), ...Array(37).fill(without)])).toBe(false);
  });
  it('glasgow: 12 of 12 -> promise', () => {
    expect(hubPromisesHours(Array(12).fill(withHours))).toBe(true);
  });
  it('event venues are left out of the count (brookings_sd SDSU stadium, arena, PAC)', () => {
    const arenas = ['dana-j-dykhouse-stadium', 'first-bank-trust-arena', 'oscar-larson-performing-arts-center'];
    const places = [
      ...Array(10).fill(withHours), ...Array(10).fill(without).map((p, i) => ({ ...p, slug: `x${i}` })),
      ...arenas.map((slug) => ({ hasHours: false, slug })),
    ];
    expect(hubPromisesHours(places)).toBe(false); // 10 of 23
    expect(hubPromisesHours(places, arenas)).toBe(true); // 10 of 20
  });
  it('half counts as most; empty never promises', () => {
    expect(hubPromisesHours([withHours, without])).toBe(true);
    expect(hubPromisesHours([])).toBe(false);
  });
});

describe('shortAddress: the town, state and ZIP are not repeated on every row', () => {
  it('drops ", Brookings, SD 57006" (brookings_sd/public-library)', () => {
    expect(shortAddress('515 3rd St, Brookings, SD 57006', 'Brookings')).toBe('515 3rd St');
  });
  it('drops ", Brookings, SD" without ZIP (brookings_sd/sexauer-park)', () => {
    expect(shortAddress('Western Ave & W 10th St, Brookings, SD', 'Brookings')).toBe('Western Ave & W 10th St');
  });
  it('an address that is only the town gives nothing (brookings_sd/arrowhead-park)', () => {
    expect(shortAddress('Brookings, SD 57006', 'Brookings')).toBeNull();
  });
  it('keeps the note in brackets (moreno_valley_ca/iris-plaza-branch-library)', () => {
    expect(shortAddress('16170 Perris Blvd, Moreno Valley, CA 92551 (Iris Ave. and Perris Blvd.)', 'Moreno Valley'))
      .toBe('16170 Perris Blvd (Iris Ave. and Perris Blvd.)');
  });
  it('keeps a UK postcode, drops the town (glasgow/glasgow-green-football-centre)', () => {
    expect(shortAddress('Kings Drive, Glasgow G40 1HB', 'Glasgow')).toBe('Kings Drive, G40 1HB');
  });
  it('another town stays as written (moreno_valley_ca/farm-house-collective)', () => {
    expect(shortAddress('1393 University Ave, Riverside, CA 92507', 'Moreno Valley')).toBe('1393 University Ave, Riverside, CA 92507');
  });
  it('the town inside a street name is not cut (broomfield_co/us-36-broomfield-station)', () => {
    expect(shortAddress('8010 Transit Way, Broomfield, CO', 'Broomfield')).toBe('8010 Transit Way');
  });
  it('null stays null', () => {
    expect(shortAddress(null, 'Brookings')).toBeNull();
  });
});

describe('parkAmenities: only what the place\'s own services list states', () => {
  it('city wording (brookings_sd/pioneer-park)', () => {
    expect(parkAmenities(['Playground', 'Basketball', 'Volleyball', 'Modern restrooms', 'Pets on leash', 'Band shell']))
      .toEqual(['Playground', 'Restrooms']);
  });
  it('keys (broomfield_co/county-commons-park)', () => {
    expect(parkAmenities(['playground', 'sports_fields', 'dog_park', 'picnic_area', 'restrooms']))
      .toEqual(['Playground', 'Restrooms', 'Dog park']);
  });
  it('off-leash wording (brookings_sd/bark-park)', () => {
    expect(parkAmenities(['Pets off leash'])).toEqual(['Dogs off leash']);
  });
  it('no services, no amenities (moreno_valley_ca/hound-town-dog-park: the name alone is not data)', () => {
    expect(parkAmenities(null)).toEqual([]);
  });
});
