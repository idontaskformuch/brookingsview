/** Rollout b (owner 2026-11-26 (10)): /tonight and /today use the /events/ day block. Rows: Broomfield /tonight/ as built 2026-11-26
 *  (Thu 26 Nov: Happy Hour and Wing Wednesday at The Old Man Bar, venue register; $5 Thursdays! at La Rumba, Denver, Ticketmaster),
 *  title, venue and time ordagrant; Moreno Valley /this-week/ 2026-11-26 (Happy Thanksgiving, Farm House Collective, Riverside). */
import { describe, expect, it } from 'vitest';
import { eveningRow, isNearbyEntry } from './evening-rows';
import { eveningGroup, groupForTicketmaster, type EveningEntry } from './evening-items';
import { planBucket, type BucketRow } from './today-buckets';
import { withoutNearbyWord } from './day-digest';

const TZ = 'America/Denver';
const e = (o: Partial<EveningEntry> & Pick<EveningEntry, 'id' | 'title' | 'start'>): EveningEntry => ({
  end: null, group: null, labels: [], venue: null, href: null, source: 'own', distanceMiles: null, driveMinutes: null, checked: '2026-11-26', ...o,
});
const happyHour = e({ id: 'reg:The Old Man Bar|Happy Hour|2026-11-26', title: 'Happy Hour', start: '2026-11-26T22:00:00.000Z', venue: 'The Old Man Bar', source: 'register', recurring: true, href: 'https://theoldmanbar.com/' });
const wings = e({ id: 'reg:The Old Man Bar|Wing Wednesday|2026-11-26', title: 'Wing Wednesday', start: '2026-11-27T00:00:00.000Z', venue: 'The Old Man Bar', source: 'register', href: 'https://theoldmanbar.com/' });
const rumba = e({ id: 'tm:rumba', title: '$5 Thursdays!', start: '2026-11-27T03:00:00.000Z', venue: 'La Rumba', venueCity: 'Denver', source: 'ticketmaster', distanceMiles: 14, driveMinutes: 25, href: 'https://www.ticketweb.com/event/5-thursdays-la-rumba-tickets/14036764' });

describe('an evening entry as the shared row', () => {
  it('Denver is nearby for Broomfield (its stated city); the Old Man Bar is the town', () => {
    expect([isNearbyEntry(happyHour, 'Broomfield'), isNearbyEntry(rumba, 'Broomfield')]).toEqual([false, true]);
    expect(eveningRow(rumba, 'Broomfield', TZ)).toMatchObject({ place: ['La Rumba', 'Denver'], nearby: { city: 'Denver', ticket: true } });
    const hh = eveningRow(happyHour, 'Broomfield', TZ);
    expect([hh.recurring, 'nearby' in hh]).toEqual([true, false]);
  });
});

describe('planBucket: the /today bucket as the /events/ day block', () => {
  const row = (en: EveningEntry, rank: number | null): BucketRow & { id: string } => {
    const r = eveningRow(en, 'Broomfield', TZ);
    return { id: en.id, nearby: r.nearby ?? null, rank, category: r.category, free: false };
  };
  it('Thu 26 Nov: the one-off is featured, the weekly happy hour is not; La Rumba goes to the Nearby block; "+1 nearby"', () => {
    const plan = planBucket([row(happyHour, null), row(wings, 1), row(rumba, null)], 5);
    expect(plan.featured?.id).toBe(wings.id);
    expect(plan.shown.map((r) => r.id)).toEqual([happyHour.id]);
    expect(plan.near).toMatchObject({ heading: 'Nearby · Denver', moreTickets: 0 });
    expect(plan.near.shown.map((r) => r.id)).toEqual([rumba.id]);
    expect(plan.digest).toBe('2 events · +1 nearby');
  });
  it('nothing in town: no featured card, the digest is the nearby count', () => {
    const plan = planBucket([row(rumba, null)], 5);
    expect([plan.featured, plan.shown.length, plan.digest]).toEqual([null, 0, '+1 nearby']);
  });
});

describe('inside the Nearby block a place says its town once (owner 2026-11-26 (10))', () => {
  it('"Farm House Collective · Nearby, Riverside" -> "Farm House Collective · Riverside"; "Nearby · Riverside" -> "Riverside"', () => {
    expect(withoutNearbyWord('Farm House Collective · Nearby, Riverside')).toBe('Farm House Collective · Riverside');
    expect(withoutNearbyWord('Nearby · Riverside')).toBe('Riverside');
    expect(withoutNearbyWord('La Rumba')).toBe('La Rumba');
  });
});

describe('the evening groups go through categorize (owner 2026-11-26 (10))', () => {
  it('the source label first: a calendar\'s "Music" makes Live music; Ticketmaster segment then genre', () => {
    expect(eveningGroup({ source: ['Music'], title: 'Wing Wednesday' })).toBe('Live music');
    expect(groupForTicketmaster('Music', 'Dance/Electronic', 'Eric Prydz (16+ Event)')).toBe('Clubs & late');
    expect(groupForTicketmaster('Arts & Theatre', 'Theatre', 'Joseph and the Amazing Technicolor Dreamcoat')).toBe('Theatre');
    expect(groupForTicketmaster('Arts & Theatre', 'Comedy', 'Sam Tallent')).toBe('Comedy & shows');
  });
  it('a category with no evening group gives none: Riverside Christmas Market ("Museums & exhibitions") is arts, not a show', () => {
    expect(eveningGroup({ source: ['Museums & exhibitions'], title: 'Riverside Christmas Market', venue: 'Riverside Museum' })).toBeNull();
  });
});
