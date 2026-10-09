import { describe, expect, it } from 'vitest';
import { buildFacilityLede, pickAddressConnector, facilityTitleElements, facilityMapLink } from './facility-lede';

describe('buildFacilityLede', () => {
  it('appends the address as a second sentence after the description', () => {
    const lede = buildFacilityLede(
      'A 98,000-square-foot city-operated facility.',
      '280 Spader Way, Broomfield, CO 80020',
      'broomfield-community-center',
    );
    expect(lede).toMatch(/^A 98,000-square-foot city-operated facility\. .+ 280 Spader Way, Broomfield, CO 80020\.$/);
  });

  it('uses one of the known connectors', () => {
    const CONNECTORS = ["It's located at", 'Find it at', "You'll find it at", 'Address:'];
    const lede = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'some-slug');
    expect(CONNECTORS.some((c) => lede!.includes(c))).toBe(true);
  });

  it('is deterministic -- the same slug always picks the same connector', () => {
    const first = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'usps-broomfield');
    const second = buildFacilityLede('Desc.', '123 Main St, Anytown, ST 00000', 'usps-broomfield');
    expect(first).toBe(second);
  });

  it('varies the connector across different slugs (not one fixed template)', () => {
    // Real facility slugs from data/facilities/broomfield_co.json -- confirms
    // this doesn't collapse to the same connector for every real page.
    const slugs = [
      'broomfield-community-center', 'broomfield-police-department', 'library',
      'city-hall', 'county-commons-park', 'north-metro-fire-headquarters',
      'north-metro-fire-station-61', 'usps-broomfield', 'usps-broomfield-eagle-view',
    ];
    const connectors = new Set(slugs.map((s) => pickAddressConnector(s)));
    expect(connectors.size).toBeGreaterThan(1);
  });

  it('falls back to the address alone when there is no description', () => {
    const lede = buildFacilityLede(null, '123 Main St, Anytown, ST 00000', 'some-slug');
    expect(lede).not.toBeNull();
    expect(lede).toMatch(/123 Main St, Anytown, ST 00000\.$/);
  });

  it('falls back to the description alone when there is no address', () => {
    const lede = buildFacilityLede('Just a description.', null, 'some-slug');
    expect(lede).toBe('Just a description.');
  });

  it('returns null when neither description nor address exists', () => {
    expect(buildFacilityLede(null, null, 'some-slug')).toBeNull();
  });

  // Answer-engine-visibility handoff, Section 5: real hours/phone facts
  // appended when present, to get closer to the 40-60-word reference-page
  // target using only data already shown elsewhere on the same page --
  // never invented to pad the count.
  it('appends hours and phone as additional real-fact sentences when present', () => {
    const lede = buildFacilityLede(
      'The city\'s public library.', '515 3rd St, Brookings, SD 57006', 'public-library',
      'Mon-Thu 9:30am-9pm, Fri-Sat 9:30am-5:30pm, Sun 1pm-5pm', '(605) 692-9407',
    );
    expect(lede).toContain('Mon-Thu 9:30am-9pm');
    expect(lede).toContain('(605) 692-9407');
  });

  it('omits hours/phone sentences entirely when those fields are null (never inventing them)', () => {
    const lede = buildFacilityLede('A city park.', '123 Main St, Anytown, ST 00000', 'some-park', null, null);
    expect(lede).toBe('A city park. Find it at 123 Main St, Anytown, ST 00000.');
  });

  it('can render hours/phone alone even with no description or address', () => {
    const lede = buildFacilityLede(null, null, 'some-slug', 'Mon-Fri 9am-5pm', '555-1234');
    expect(lede).toBe('Open Mon-Fri 9am-5pm. Reach it at 555-1234.');
  });
});

describe('pickAddressConnector', () => {
  it('is a pure function of the slug alone', () => {
    expect(pickAddressConnector('city-hall')).toBe(pickAddressConnector('city-hall'));
  });
});

describe('facilityTitleElements (Phase 2, item 2f)', () => {
  // Short name ("Quail Creek Park", 16 chars) -- plenty of budget room for
  // every test below unless the test itself is specifically about budget
  // pressure.
  const SHORT_NAME = 16;

  it('lists all three, in fixed Hours/Address/Phone order, regardless of argument order meaning', () => {
    expect(facilityTitleElements(true, true, true, SHORT_NAME)).toBe(' — Hours, Address & Phone');
  });

  it('lists two with an ampersand, no Oxford comma', () => {
    expect(facilityTitleElements(true, true, false, SHORT_NAME)).toBe(' — Hours & Address');
    expect(facilityTitleElements(false, true, true, SHORT_NAME)).toBe(' — Address & Phone');
  });

  it('lists one alone with no ampersand', () => {
    expect(facilityTitleElements(false, true, false, SHORT_NAME)).toBe(' — Address');
  });

  it('is empty (not a dangling dash) when none are present', () => {
    expect(facilityTitleElements(false, false, false, SHORT_NAME)).toBe('');
  });

  it('matches the real, common Broomfield-park case: address only', () => {
    // Real live data (2026-10-09): 9 of 10 checked Broomfield parks have
    // ONLY an address -- no phone, no hours.
    expect(facilityTitleElements(false, true, false, SHORT_NAME)).toBe(' — Address');
  });

  describe('length budget (owner-caught, 2026-10-09: real names are up to 60+ chars alone)', () => {
    // Real live name, 41 chars -- the full 3-element suffix (25 chars)
    // doesn't fit under the default 60-char budget, but dropping Phone
    // (the 2-element "Hours & Address" suffix, 18 chars) does: 41+18=59.
    const ADVENTURE_CENTER_NAME = 'Brookings County Outdoor Adventure Center'.length;
    // Real live name, 53 chars -- even the single-element "— Address"
    // suffix (10 chars) no longer fits: 53+10=63, over the 60 budget.
    const CITY_HALL_NAME = 'Brookings City Hall (City & County Government Center)'.length;

    it('drops Phone first when the full 3-element suffix would blow the default 60-char budget', () => {
      expect(facilityTitleElements(true, true, true, ADVENTURE_CENTER_NAME)).toBe(' — Hours & Address');
    });

    it('drops the whole suffix when even "— Address" alone does not fit', () => {
      expect(facilityTitleElements(true, true, true, CITY_HALL_NAME)).toBe('');
    });

    it('a shorter real name keeps the full suffix under the same budget', () => {
      // "Dakota Nature Park" = 18 chars; 18 + 25 = 43, well under 60.
      expect(facilityTitleElements(true, true, true, 'Dakota Nature Park'.length)).toBe(' — Hours, Address & Phone');
    });

    it('respects a custom budget argument', () => {
      expect(facilityTitleElements(true, true, true, 10, 15)).toBe('');
      expect(facilityTitleElements(true, true, true, 10, 100)).toBe(' — Hours, Address & Phone');
    });

    it('falls back to a single field when address is unavailable but hours or phone would otherwise fit', () => {
      expect(facilityTitleElements(true, false, false, SHORT_NAME)).toBe(' — Hours');
      expect(facilityTitleElements(false, false, true, SHORT_NAME)).toBe(' — Phone');
    });
  });
});

describe('facilityMapLink (Phase 2, item 2f)', () => {
  it('prefers lat/lon (an exact pin) when both exist', () => {
    expect(facilityMapLink(44.3105, -96.7978, '520 3rd St, Brookings, SD 57006'))
      .toBe('https://www.google.com/maps/search/?api=1&query=44.3105,-96.7978');
  });

  it('falls back to the address as a search query when there is no lat/lon -- the real Broomfield case (0 of 19 geocoded today)', () => {
    expect(facilityMapLink(null, null, '280 Spader Way, Broomfield, CO 80020'))
      .toBe('https://www.google.com/maps/search/?api=1&query=280%20Spader%20Way%2C%20Broomfield%2C%20CO%2080020');
  });

  it('returns null when there is neither -- never a guessed location', () => {
    expect(facilityMapLink(null, null, null)).toBeNull();
  });
});
