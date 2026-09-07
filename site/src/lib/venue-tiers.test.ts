import { describe, it, expect } from 'vitest';
import { venueTierFor, venueTierRank, DEFAULT_VENUE_TIER } from './venue-tiers';

describe('venueTierFor', () => {
  it('maps a known Brookings venue to its real tier', () => {
    expect(venueTierFor('brookings_sd', 'The Oscar Larson Performing Arts Center')).toBe('large');
    expect(venueTierFor('brookings_sd', 'University Student Union')).toBe('medium');
    expect(venueTierFor('brookings_sd', 'South Dakota Art Museum')).toBe('small');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(venueTierFor('brookings_sd', '  the oscar larson performing arts center  ')).toBe('large');
    expect(venueTierFor('brookings_sd', 'THE OSCAR LARSON PERFORMING ARTS CENTER')).toBe('large');
  });

  it('falls back to the default tier for an unrecognized venue in a known town', () => {
    expect(venueTierFor('brookings_sd', 'Some Brand New Venue Nobody Has Seen Yet')).toBe(DEFAULT_VENUE_TIER);
  });

  it('a real Ticketmaster venue (What\'s On Phase 3) falls back to the default tier cleanly, not an error -- not curated yet on purpose (real venue data curation is flagged as a follow-up, not guessed)', () => {
    expect(venueTierFor('brookings_sd', 'Dana J. Dykhouse Stadium')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', 'Dacotah Bank Center')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', 'First Bank and Trust Arena')).toBe(DEFAULT_VENUE_TIER);
  });

  it('falls back to the default tier for an unknown town entirely', () => {
    expect(venueTierFor('some_future_town', 'Any Venue')).toBe(DEFAULT_VENUE_TIER);
  });

  it('never throws on null, undefined, or empty/whitespace-only venue strings', () => {
    expect(venueTierFor('brookings_sd', null)).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', undefined)).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', '')).toBe(DEFAULT_VENUE_TIER);
    expect(venueTierFor('brookings_sd', '   ')).toBe(DEFAULT_VENUE_TIER);
  });
});

describe('venueTierRank', () => {
  it('orders small < medium < large', () => {
    expect(venueTierRank('small')).toBeLessThan(venueTierRank('medium'));
    expect(venueTierRank('medium')).toBeLessThan(venueTierRank('large'));
  });
});
