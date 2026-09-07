import { describe, it, expect } from 'vitest';
import { venueTierFor, venueTierRank, isVenueCurated, normalizeVenueName, DEFAULT_VENUE_TIER } from './venue-tiers';

describe('normalizeVenueName (What\'s On Phase 7 follow-up, "Venue Curation")', () => {
  it('strips a trailing real state-code suffix, spaced or not -- the exact two real confirmed-live shapes (Orpheum Theater Sioux Falls - SD, and Toyota Arena-CA once curated)', () => {
    expect(normalizeVenueName('Orpheum Theater Sioux Falls - SD')).toBe('orpheum theater sioux falls');
    expect(normalizeVenueName('Toyota Arena-CA')).toBe('toyota arena');
  });

  it('does NOT strip a trailing two-letter sequence that is not a real state code -- narrow, not aggressive', () => {
    expect(normalizeVenueName('The Venue-XY')).toBe('the venue-xy');
    expect(normalizeVenueName('Studio-Q')).toBe('studio-q'); // single letter, never matches the 2-letter pattern at all
  });

  it('strips straight and curly apostrophes -- the real confirmed-live "Yaamava\' Resort & Casino" vs "Yaamava Resort & Casino" duplicate', () => {
    expect(normalizeVenueName("Yaamava' Resort & Casino at San Manuel")).toBe('yaamava resort & casino at san manuel');
    expect(normalizeVenueName('Yaamava’ Resort & Casino at San Manuel')).toBe('yaamava resort & casino at san manuel');
    expect(normalizeVenueName('Yaamava Resort & Casino at San Manuel')).toBe('yaamava resort & casino at san manuel');
  });

  it('preserves an ampersand and other meaningful punctuation -- normalization is narrow on purpose', () => {
    expect(normalizeVenueName('Washington Pavilion of Arts & Science')).toBe('washington pavilion of arts & science');
  });

  it('collapses whitespace and trims, same as the original behavior', () => {
    expect(normalizeVenueName('  The   District  ')).toBe('the district');
  });

  it('genuinely distinct venues stay distinct after normalization -- does not over-collapse', () => {
    expect(normalizeVenueName('The District')).not.toBe(normalizeVenueName('Grand Falls Casino Resort'));
    expect(venueTierFor('brookings_sd', 'The District')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'BIGS Sports Bar')).toBe('small');
  });
});

describe('venueTierFor', () => {
  it('maps a known Brookings venue to its real tier (Oscar Larson revised to medium -- see this file\'s own comment: real capacity, 1,000 seats, is smaller than several curated Sioux Falls venues)', () => {
    expect(venueTierFor('brookings_sd', 'The Oscar Larson Performing Arts Center')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'University Student Union')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'South Dakota Art Museum')).toBe('small');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(venueTierFor('brookings_sd', '  the oscar larson performing arts center  ')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'THE OSCAR LARSON PERFORMING ARTS CENTER')).toBe('medium');
  });

  it('falls back to the default tier for an unrecognized venue in a known town', () => {
    expect(venueTierFor('brookings_sd', 'Some Brand New Venue Nobody Has Seen Yet')).toBe(DEFAULT_VENUE_TIER);
  });

  it('a Ticketmaster venue never observed in a live response still falls back to the default tier cleanly, not an error (Dana J. Dykhouse Stadium is a real SDSU Athletics venue, filtered out by isSportsEvent() before it would ever reach ranking anyway)', () => {
    expect(venueTierFor('brookings_sd', 'Dana J. Dykhouse Stadium')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', 'Dacotah Bank Center')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', 'First Bank and Trust Arena')).toBe(DEFAULT_VENUE_TIER);
  });

  it('falls back to the default tier for an unknown town entirely', () => {
    expect(venueTierFor('some_future_town', 'Any Venue')).toBe(DEFAULT_VENUE_TIER);
  });

  it('resolves the Orpheum Theater tier whether or not the raw name still carries its trailing " - SD" (What\'s On Phase 7 follow-up: the stored map key itself was updated to match normalizeVenueName()\'s own output)', () => {
    expect(venueTierFor('brookings_sd', 'Orpheum Theater Sioux Falls - SD')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'Orpheum Theater Sioux Falls')).toBe('medium');
  });

  it('never throws on null, undefined, or empty/whitespace-only venue strings', () => {
    expect(venueTierFor('brookings_sd', null)).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', undefined)).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', '')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', '   ')).toBe(DEFAULT_VENUE_TIER);
  });

  // What's On Phase 5 follow-up ("Radius Fix" review): real Sioux Falls-area
  // venues, curated by Discovery API's own stable venue id, with real
  // checked capacity figures behind each tier -- see VENUE_TIERS_BY_ID's
  // own comment in venue-tiers.ts for sources/reasoning.
  describe('real Ticketmaster venues, curated by id (What\'s On Phase 5 follow-up)', () => {
    it('Denny Sanford PREMIER Center (~10,000-12,000) is large -- the only arena-scale venue in this town\'s entire feed, SDSU campus included', () => {
      expect(venueTierFor('brookings_sd', 'Denny Sanford PREMIER Center', 'KovZpZAJAl7A')).toBe('large');
    });

    it('resolves correctly via Denny Sanford PREMIER Center\'s SECOND, different Discovery API venue id -- a real confirmed case, not hypothetical: "Zac Brown Band w/ Brothers Osborne" and "Zach Top w/ Marty Stuart..." both carried this id live while every other Denny Sanford listing in the same feed carried the first', () => {
      expect(venueTierFor('brookings_sd', 'Denny Sanford PREMIER Center', 'Z7r9jZaers')).toBe('large');
    });

    it('Washington Pavilion of Arts & Science (1,800, Great Hall) is medium', () => {
      expect(venueTierFor('brookings_sd', 'Washington Pavilion of Arts & Science', 'ZFr9jZA7a6')).toBe('medium');
    });

    it('The District (1,500) is medium', () => {
      expect(venueTierFor('brookings_sd', 'The District', 'ZFr9jZ11FA')).toBe('medium');
    });

    it('Grand Falls Casino Resort (~1,100) is medium', () => {
      expect(venueTierFor('brookings_sd', 'Grand Falls Casino Resort', 'ZFr9jZaAkv')).toBe('medium');
    });

    it('Icon Events & Dada Gastropub (up to 700) is medium -- real capacity places it above Orpheum despite reading, by name, like a smaller room', () => {
      expect(venueTierFor('brookings_sd', 'Icon Events & Dada Gastropub', 'rZ7HnEZ178xxA')).toBe('medium');
    });

    it('Orpheum Theater Sioux Falls (686) is medium', () => {
      expect(venueTierFor('brookings_sd', 'Orpheum Theater Sioux Falls - SD', 'ZFr9jZF6eF')).toBe('medium');
    });

    it('BIGS Sports Bar (300) is small', () => {
      expect(venueTierFor('brookings_sd', 'BIGS Sports Bar', 'rZ7HnEZ178s_A')).toBe('small');
    });
  });

  describe('name-keyed fallback for the same real Ticketmaster venues (safety net added after the second-id discovery above)', () => {
    it('resolves the correct tier by name alone, with no id at all', () => {
      expect(venueTierFor('brookings_sd', 'Denny Sanford PREMIER Center')).toBe('large');
      expect(venueTierFor('brookings_sd', 'Washington Pavilion of Arts & Science')).toBe('medium');
      expect(venueTierFor('brookings_sd', 'BIGS Sports Bar')).toBe('small');
    });

    it('resolves by name when a THIRD, still-uncurated id is passed for an already-curated venue', () => {
      expect(venueTierFor('brookings_sd', 'Denny Sanford PREMIER Center', 'some-future-third-id')).toBe('large');
    });

    it('is case- and whitespace-insensitive, same as every other name-keyed lookup', () => {
      expect(venueTierFor('brookings_sd', '  DENNY SANFORD PREMIER CENTER  ')).toBe('large');
    });
  });

  describe('id takes precedence over name (What\'s On Phase 5 follow-up)', () => {
    it('a curated id wins even when the accompanying name would not have matched anything (name drift)', () => {
      expect(venueTierFor('brookings_sd', 'Some Renamed Sponsor Arena', 'KovZpZAJAl7A')).toBe('large');
    });

    it('an uncurated id falls through to name-based matching rather than forcing the default', () => {
      expect(venueTierFor('brookings_sd', 'The Oscar Larson Performing Arts Center', 'some-unrelated-id')).toBe('medium');
    });

    it('an uncurated id AND an unrecognized name both fall back to the default tier', () => {
      expect(venueTierFor('brookings_sd', 'Totally Unknown Venue', 'some-unrelated-id')).toBe(DEFAULT_VENUE_TIER);
    });

    it('a null/undefined venueId is safely ignored, falling straight through to name matching (BIGS Sports Bar is curated by BOTH id and name, so either path lands on the correct tier)', () => {
      expect(venueTierFor('brookings_sd', 'BIGS Sports Bar', null)).toBe('small');
      expect(venueTierFor('brookings_sd', 'BIGS Sports Bar', undefined)).toBe('small');
      expect(venueTierFor('brookings_sd', 'BIGS Sports Bar', 'rZ7HnEZ178s_A')).toBe('small');
    });

    it('a venue with neither a curated id nor a curated name genuinely falls through to the default', () => {
      expect(venueTierFor('brookings_sd', 'Some Brand New Sioux Falls Venue', 'some-unrelated-id')).toBe(DEFAULT_VENUE_TIER);
    });
  });
});

describe('venueTierRank', () => {
  it('orders small < medium < large', () => {
    expect(venueTierRank('small')).toBeLessThan(venueTierRank('medium'));
    expect(venueTierRank('medium')).toBeLessThan(venueTierRank('large'));
  });
});

describe('isVenueCurated (What\'s On Phase 5 follow-up -- distinguishes "genuinely unmapped" from "deliberately curated at the default tier")', () => {
  it('is true for a venue curated by id, even when its tier happens to equal the default', () => {
    expect(isVenueCurated('brookings_sd', 'BIGS Sports Bar', 'rZ7HnEZ178s_A')).toBe(true);
  });

  it('is true for a venue curated by name only, even when its tier happens to equal the default', () => {
    expect(isVenueCurated('brookings_sd', 'BIGS Sports Bar')).toBe(true);
  });

  it('is true for a large/medium-tier venue, the more obvious case', () => {
    expect(isVenueCurated('brookings_sd', 'Denny Sanford PREMIER Center', 'KovZpZAJAl7A')).toBe(true);
    expect(isVenueCurated('brookings_sd', 'Orpheum Theater Sioux Falls - SD', 'ZFr9jZF6eF')).toBe(true);
  });

  it('is false for a venue with no curated entry at all -- the actual bug this function fixes: a naive venueTierFor() === DEFAULT_VENUE_TIER check can\'t tell this apart from BIGS Sports Bar above, since both resolve to \'small\'', () => {
    expect(isVenueCurated('brookings_sd', 'Some Brand New Sioux Falls Venue', 'some-unrelated-id')).toBe(false);
  });

  it('never throws on null/undefined venue name or id', () => {
    expect(isVenueCurated('brookings_sd', null)).toBe(false);
    expect(isVenueCurated('brookings_sd', undefined, null)).toBe(false);
  });
});
