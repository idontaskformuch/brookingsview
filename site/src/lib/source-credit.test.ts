import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sourceCreditName, sourceOwnerLabel } from './source-credit';

describe('sourceCreditName', () => {
  it('credits the city for its own calendar links, with or without www', () => {
    expect(sourceCreditName('https://www.broomfield.org/calendar.aspx?EID=11038')).toBe('City and County of Broomfield');
    expect(sourceCreditName('https://broomfield.org/calendar.aspx?EID=1')).toBe('City and County of Broomfield');
  });
  it('credits the library calendar separately', () => {
    expect(sourceCreditName('https://compass.broomfield.org/events/x')).toBe('Broomfield Library (Compass)');
  });
  it('credits Glasgow Life for its event pages', () => {
    expect(sourceCreditName('https://www.glasgowlife.org.uk/event/1/sunday-colouring-club')).toBe('Glasgow Life');
  });
  it('returns null for unknown hosts and bad input', () => {
    expect(sourceCreditName('https://example.com/x')).toBeNull();
    expect(sourceCreditName('not a url')).toBeNull();
    expect(sourceCreditName(null)).toBeNull();
  });
});

// QA web.place-source-owner (owner order 2026-11-25, punkt 2): a facility page's "Source" link named the town for every
// source_url ("Brookings official site"), also for McCrory Gardens, whose source is SDSU's page. Real rows, brookings_sd places.
describe('QA web.place-source-owner: the Source link names who owns the linked site', () => {
  it('McCrory Gardens (place 107) credits SDSU, not the City', () => {
    expect(sourceOwnerLabel('https://www.sdstate.edu/mccrory-gardens/plan-your-visit-mccrory')).toBe(
      'South Dakota State University (SDSU) website',
    );
  });
  it('city-hall (place 2) credits the City of Brookings', () => {
    expect(
      sourceOwnerLabel('https://www.cityofbrookings-sd.gov/facilities/facility/details/City-and-County-Government-Center-16'),
    ).toBe('City of Brookings website');
  });
  it("an unlisted owner shows the bare host (Children's Museum, place 238)", () => {
    expect(sourceOwnerLabel('https://prairieplay.org/hours-admission/')).toBe('prairieplay.org');
  });
  it('the facility page no longer hard-codes the town as the source owner', () => {
    const page = readFileSync(fileURLToPath(new URL('../pages/facilities/[slug].astro', import.meta.url)), 'utf8');
    expect(page).not.toMatch(/cityName\}\s*official site/);
    expect(page).toContain('sourceOwnerLabel(facility.source_url)');
  });
});
