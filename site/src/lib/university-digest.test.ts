/** University digest rules (lib/university-digest.ts). Real rows, brookings_sd week 2026-W47 (Mon Nov 16 - Sun Nov 22):
 *  sport_events 17, 49, 18, 12, 104, 50 (program sdsu; scores of the final #17 left null, the one changed field), sdsu_events
 *  25818, 20205, 21606, 17743, 20807, 23851, 12953, 228, academic_calendar_dates Fall 2026. */
import { describe, expect, it } from 'vitest';
import type { AcademicDate } from './db';
import type { SportEventRow } from './sport-events';
import { gamesFromEvents } from './sport-games';
import {
  ACADEMIC_LOOKAHEAD_DAYS, academicLine, buildDigest, dedupeEvents, nextHomeGameLine, type DigestEvent,
} from './university-digest';

const TZ = 'America/Chicago';
const WEEK = { start: new Date('2026-11-16T06:00:00Z'), end: new Date('2026-11-23T06:00:00Z') };
const NOW = new Date('2026-11-18T20:00:00Z'); // Wed Nov 18, 2pm

const ev = (id: number, sport: string, gender: string, start: string, status: string, tba: boolean, neutral: boolean,
  home: string | null, homeName: string | null, away: string | null, awayName: string | null, venue: string): SportEventRow => ({
  id, sport, gender, startAt: new Date(start), tz: TZ, status, timeTba: tba, neutralSite: neutral, exhibition: false, venue,
  homeProgramId: home, homeName, awayProgramId: away, awayName, scoreHome: null, scoreAway: null,
} as SportEventRow);

const ROWS: SportEventRow[] = [
  ev(17, 'basketball', 'men', '2026-11-17T01:00:00Z', 'final', false, false, 'sdsu', null, null, 'Mayville State', 'Brookings, S.D. (First Bank & Trust Arena)'),
  ev(49, 'basketball', 'women', '2026-11-19T01:00:00Z', 'scheduled', false, false, 'sdsu', null, null, 'Wyoming', 'Brookings, S.D. (First Bank & Trust Arena)'),
  ev(18, 'basketball', 'men', '2026-11-20T21:00:00Z', 'scheduled', false, false, null, 'Idaho State', 'sdsu', null, 'Pocatello, Idaho'),
  ev(12, 'football', 'men', '2026-11-21T20:00:00Z', 'scheduled', false, false, 'sdsu', null, null, 'Indiana State', 'Brookings, S.D. (Dana J. Dykhouse Stadium)'),
  ev(104, 'volleyball', 'women', '2026-11-22T06:00:00Z', 'scheduled', true, false, 'sdsu', null, null, 'Summit League Championship', 'Brookings, S.D. (First Bank & Trust Arena)'),
  ev(50, 'basketball', 'women', '2026-11-22T19:30:00Z', 'scheduled', false, true, 'sdsu', null, null, 'Kansas', 'Kansas City, Mo. • T-Mobile Center'),
];
const GAMES = gamesFromEvents(ROWS, 'sdsu', NOW);

const sdsu = (id: number, title: string, location: string, start: string, bucket: string, cat: string | null): DigestEvent => ({
  external_event_id: String(id), title, teaser: null, location, starts_at: start, ends_at: null, categories: [], primary_category: cat,
  event_url: `https://www.sdstate.edu/events/${id}`, bucket,
});
const EVENTS: DigestEvent[] = [
  sdsu(25818, 'Goodbye Amy', 'Lincoln Hall', '2026-11-16T20:30:00Z', 'arts_culture', 'Special Events'),
  sdsu(20205, 'MBB vs Mayville State', 'Stanley J. Marshall Center', '2026-11-17T01:00:00Z', 'university', 'Athletics'),
  sdsu(21606, 'MBB vs Mayville State', 'Stanley J. Marshall Center', '2026-11-17T01:00:00Z', 'university', 'Athletics'),
  sdsu(17743, 'SDSU Jazz Ensembles Fall Concert', 'The Oscar Larson Performing Arts Center', '2026-11-17T01:30:00Z', 'arts_culture', 'Music'),
  sdsu(20807, '2026 Region 3 Oral Interp', 'University Student Union', '2026-11-17T14:00:00Z', 'university', 'Camps/Conferences'),
  sdsu(23851, '2026 Region 3 Oral Interp', 'University Student Union', '2026-11-17T14:45:00Z', 'university', 'Camps/Conferences'),
  sdsu(12953, 'Brookings Area Master Gardeners Meeting', 'McCrory Gardens Education and Visitor Center', '2026-11-19T23:30:00Z', 'arts_culture', null),
  sdsu(228, 'Brookings Area Master Gardeners Meeting', 'McCrory Gardens Education and Visitor Center', '2026-11-19T23:30:00Z', 'arts_culture', null),
];
const ACADEMIC: AcademicDate[] = [
  { label: "Veterans' Day holiday", term: 'Fall 2026', category: 'holiday', starts_on: '2026-11-11', ends_on: null },
  { label: 'Thanksgiving recess', term: 'Fall 2026', category: 'break', starts_on: '2026-11-25', ends_on: '2026-11-29' },
  { label: 'No classes; final exam preparation', term: 'Fall 2026', category: 'deadline', starts_on: '2026-12-09', ends_on: null },
];
const input = { events: EVENTS, games: GAMES, academic: ACADEMIC, week: WEEK, now: NOW, timezone: TZ, programName: 'Jackrabbits' };

describe('buildDigest (week 2026-W47)', () => {
  const d = buildDigest(input);
  it('insight lines, one per rule that fires', () => {
    expect(d.insights).toEqual([
      '5 campus events this week',
      '6 Jackrabbits games, 4 at home',
      "Next home game: Women's basketball vs Wyoming, Wed Nov 18, 7pm",
      'Thanksgiving recess starts Wed Nov 25',
    ]);
  });
  it('Games come from sport_events; the Athletics rows of the SDSU calendar are not listed', () => {
    expect(d.games.map((g) => g.id)).toEqual([17, 49, 18, 12, 104, 50]);
    expect([...d.open, ...d.campus].some((e) => e.primary_category === 'Athletics')).toBe(false);
  });
  it('open to the public = arts_culture, duplicate rows once; campus = university without Athletics', () => {
    expect(d.open.map((e) => e.external_event_id)).toEqual(['25818', '17743', '12953']);
    expect(d.campus.map((e) => e.external_event_id)).toEqual(['20807', '23851']);
  });
  it('academic dates: the week plus the lookahead, nothing older', () => {
    expect(ACADEMIC_LOOKAHEAD_DAYS).toBe(7);
    expect(d.academic.map((a) => a.label)).toEqual(['Thanksgiving recess']);
  });
});

describe('rules that do not fire', () => {
  it('no events, no games, no academic dates -> no lines', () => {
    expect(buildDigest({ ...input, events: [], games: [], academic: [] }).insights).toEqual([]);
  });
  it('E1/G1 singular', () => {
    const d = buildDigest({ ...input, events: [EVENTS[0]], games: GAMES.filter((g) => g.id === 18), academic: [] });
    expect(d.insights).toEqual(['1 campus event this week', '1 Jackrabbits game']); // away only: no "at home", no next home game
  });
  it('G1 all at home', () => {
    expect(buildDigest({ ...input, events: [], games: GAMES.filter((g) => g.id === 12), academic: [] }).insights[0])
      .toBe('1 Jackrabbits game, all at home');
  });
  it('G2 skips finished games and TBA times', () => {
    const later = new Date('2026-11-22T00:00:00Z'); // after football; only volleyball (TBA) left at home
    expect(nextHomeGameLine(gamesFromEvents(ROWS, 'sdsu', later), TZ)).toBeNull();
    expect(nextHomeGameLine(gamesFromEvents(ROWS, 'sdsu', new Date('2026-11-20T00:00:00Z')), TZ))
      .toBe('Next home game: Football vs Indiana State, Sat Nov 21, 2pm');
  });
});

describe('A1 academic line shapes', () => {
  it('single day, range starting in the week, range that began before it', () => {
    expect(academicLine(ACADEMIC[0], WEEK, TZ)).toBe("Veterans' Day holiday: Wed Nov 11");
    expect(academicLine(ACADEMIC[1], WEEK, TZ)).toBe('Thanksgiving recess starts Wed Nov 25');
    const w48 = { start: new Date('2026-11-23T06:00:00Z') };
    expect(academicLine({ ...ACADEMIC[1], starts_on: '2026-11-21' }, w48, TZ)).toBe('Thanksgiving recess until Sun Nov 29'); // starts_on changed
  });
});

it('dedupeEvents keeps the first of two identical rows', () => {
  expect(dedupeEvents([EVENTS[6], EVENTS[7]]).map((e) => e.external_event_id)).toEqual(['12953']);
});
