import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { pickCategoryImage, pickFromPools, dateBox, distinctBy, sportsItems, cityHallItems, gettingAroundItems } from './home-blocks';
import { categoryImagesFor } from '../config/category-images';
import { HOME_SECTIONS_BY_TOWN, homeSectionsFor } from '../config/home-sections';
import { ALL_CONFIGS } from './site-config';
import { answerPagesFor } from '../config/city-answers';
import type { Game, RegionalGame, TrafficIncident } from './db';

// Real rows (CLAUDE.md #15), read 2026-11-19: sport_events 49 (Wyoming, women's basketball, home, 18 Nov 19:00 CST) and 12 (Indiana State,
// football, home, 21 Nov 14:00 CST); Broomfield meetings 11825/11824/12328; Moreno Valley traffic_incidents 4728/4727; Angels finals Sep 2026;
// Broomfield project update palisade-park-chipotle-mexican-grill (City Council Regular Meeting, 2026-09-09, pending).
const game = (o: Partial<Game>): Game => ({ id: 0, sport: 'football', opponent: '', home_away: 'home', starts_at: null, venue: null, result: null, phase: 'upcoming', ...o } as Game);
const GAMES: Game[] = [
  game({ id: 49, sport: 'wbb', opponent: 'Wyoming', starts_at: '2026-11-19T01:00:00Z' }),
  game({ id: 12, sport: 'football', opponent: 'Indiana State', starts_at: '2026-11-21T20:00:00Z' }),
];
const mtg = (o: Record<string, unknown>) => ({ items: [], agendaUrl: null, quorumNotice: false, cancelled: false, postponed: false, closed: false, collapsedGroup: null, time: '6:00 PM', typeLabel: null, ...o }) as any;
const BMF = [mtg({ id: 11825, bodyLabel: 'City Council', typeLabel: 'Transition', ymd: '2026-12-01' }), mtg({ id: 11824, bodyLabel: 'City Council', typeLabel: 'Regular', ymd: '2026-12-01' }), mtg({ id: 12328, bodyLabel: 'City Council', typeLabel: 'Regular', ymd: '2026-12-08' })];
const tr = (o: Partial<TrafficIncident>): TrafficIncident => ({ incident_type: 'chp_incident', title: '', description: null, road: null, severity: null, lat: null, lon: null, ends_at: null, last_seen_at: '2026-11-19T06:00:00Z', ...o } as TrafficIncident);

describe('sportsItems', () => {
  it('Brookings 18 Nov: the next games as date rows (basketball tonight, football Saturday)', () => {
    const items = sportsItems({ games: GAMES, regional: [], todayYmd: '2026-11-18', tz: 'America/Chicago', locale: 'en-US', teamName: 'Brookings', drawLetter: 'T' });
    expect(items.map((i) => i.title)).toEqual(['vs Wyoming', 'vs Indiana State']);
    expect(items[1].date).toEqual({ top: 'Sat', day: '21' });
    expect(items[1].kicker).toBe('Football · Home');
  });
  it('a result inside 14 days is listed after the next games; an off-season regional team gives nothing', () => {
    const withResult = [game({ id: 48, sport: 'wbb', opponent: 'Wyoming', starts_at: '2026-11-15T19:00:00Z', result: 'W 70-61', phase: 'history' }), ...GAMES];
    expect(sportsItems({ games: withResult, regional: [], todayYmd: '2026-11-18', tz: 'America/Chicago', locale: 'en-US', teamName: 'Brookings', drawLetter: 'T' }).at(-1)!.title).toBe('W 70-61 vs Wyoming');
    const angels = { league: 'mlb', team_name: 'Los Angeles Angels', team_abbr: null, opponent_name: 'Seattle Mariners', home_away: 'away', game_date: '2026-09-27', game_time_utc: null, status: 'final', team_score: 3, opponent_score: 7, venue: null, relevance_tier: 'primary' } as RegionalGame;
    expect(sportsItems({ games: [], regional: [angels], todayYmd: '2026-11-19', tz: 'America/Los_Angeles', locale: 'en-US', teamName: 'Moreno Valley', drawLetter: 'T' })).toEqual([]);
  });
});

describe("sportsItems with the driver's DATE objects (QA front.date-column-objects)", () => {
  it('a local-midnight Date for game_date (as Neon gives it) is read as that calendar day; the Moreno build failed with "Invalid time value"', () => {
    // Real row: regional_sports_games Angels at Mariners 2026-09-27 final 3-7; only game_date's type changed (string -> Date), as the driver returns it.
    const angels = { league: 'mlb', team_name: 'Los Angeles Angels', team_abbr: null, opponent_name: 'Seattle Mariners', home_away: 'away', game_date: new Date(2026, 8, 27) as unknown as string, game_time_utc: null, status: 'final', team_score: 3, opponent_score: 7, venue: null, relevance_tier: 'primary' } as RegionalGame;
    const items = sportsItems({ games: [], regional: [angels], todayYmd: '2026-09-30', tz: 'America/Los_Angeles', locale: 'en-US', teamName: 'Moreno Valley', drawLetter: 'T' });
    expect(items).toEqual([expect.objectContaining({ title: 'Los Angeles Angels L 3-7 at Seattle Mariners', date: { top: 'Sun', day: '27' } })]);
  });
});

describe('cityHallItems', () => {
  it('three meetings with date box (the browser adds "in N days" from relDay, Fas 3), then the latest decision', () => {
    const items = cityHallItems({ meetings: BMF, todayYmd: '2026-11-19', locale: 'en-US', decision: { href: '/city-hall/projects/palisade-park-chipotle-mexican-grill/', title: 'Palisade Park Chipotle Mexican Grill', meta: 'City Council Regular Meeting: pending', ymd: '2026-09-09' } });
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ title: 'City Council · Transition', meta: '6:00 PM', relDay: '2026-12-01', date: { top: 'Tue', day: '1' } });
    expect(items[0].meta).not.toMatch(/days?|today|tomorrow/);
    expect(items[3]).toMatchObject({ kicker: 'Decided', title: 'Palisade Park Chipotle Mexican Grill' });
  });
  it('no meetings and no decision: no rows (the block is not shown)', () => {
    expect(cityHallItems({ meetings: [], todayYmd: '2026-11-19', locale: 'en-US', decision: null })).toEqual([]);
  });
});

describe('gettingAroundItems', () => {
  it('incidents as rows, at most three, labelled by the shared closure rule', () => {
    const items = gettingAroundItems({ traffic: [tr({ title: 'MZP-Assist CT with Maintenance' }), tr({ title: '1182-Trfc Collision-No Inj' })], schoolClosures: [], tz: 'America/Los_Angeles', locale: 'en-US' });
    expect(items.map((i) => [i.kicker, i.title])).toEqual([['Incident', 'MZP-Assist CT with Maintenance'], ['Incident', '1182-Trfc Collision-No Inj']]);
  });
});

describe('images and helpers', () => {
  it('a category pick never repeats an image already on the page while the pool has another', () => {
    const pool = categoryImagesFor('broomfield_co').events!;
    expect(pool.length).toBeGreaterThan(1);
    const used = new Set<string>();
    const a = pickCategoryImage(pool, 'same-seed', used)!;
    const b = pickCategoryImage(pool, 'same-seed', used)!;
    expect(a.path).not.toBe(b.path);
    expect(used.has(a.path) && used.has(b.path)).toBe(true);
    expect(pickCategoryImage(undefined, 'x', used)).toBeNull();
  });
  it('an exhausted pool gives null, never a repeat; pickFromPools falls through to the next pool (QA front.hub-no-duplicate-images)', () => {
    const pools = categoryImagesFor('brookings_sd');
    const used = new Set(pools.events!.map((i) => i.path));
    expect(pickCategoryImage(pools.events, 'Gifting for Good', used)).toBeNull();
    const next = pickFromPools([pools.events, pools.city_hall], 'Gifting for Good', used)!;
    expect(pools.city_hall!.map((i) => i.path)).toContain(next.path);
  });
  it('dateBox is in the town zone; distinctBy keeps the first of a title', () => {
    expect(dateBox('2026-11-19T01:00:00Z', 'America/Chicago', 'en-US')).toEqual({ top: 'Wed', day: '18' });
    expect(dateBox('2026-11-19T01:00:00Z', 'Europe/London', 'en-GB', 'month')).toEqual({ top: 'Nov', day: '19' });
    expect(distinctBy([{ t: 'The Mix' }, { t: 'the mix ' }, { t: 'Talk MoVal' }], (x) => x.t, 4)).toEqual([{ t: 'The Mix' }, { t: 'Talk MoVal' }]);
  });
});

describe('config/home-sections.ts', () => {
  it('every town has a section order, no block twice, and every guide is a page the site builds', () => {
    for (const c of ALL_CONFIGS) {
      const s = homeSectionsFor(c.townId);
      const ids = [...s.upper, ...s.beside, ...s.lower];
      expect(new Set(ids).size, c.townId).toBe(ids.length);
      for (const g of s.guides) {
        const p = g.href.replace(/^\/|\/$/g, '');
        const exists = ['.astro', '/index.astro'].some((ext) => existsSync(new URL(`../pages/${p}${ext}`, import.meta.url)))
          || existsSync(new URL(`../pages/[${p}].astro`, import.meta.url)) || (p === 'events/free' && existsSync(new URL('../pages/events/[facet].astro', import.meta.url)))
          || answerPagesFor(c.townId).some((a) => a.slug === p); // a "How do I..." page of the town (config/city-answers, Fas 3)
        expect(exists, `${c.townId} ${g.href}`).toBe(true);
      }
    }
  });
  it('per-town order (owner): Brookings has Sports first beside the rail, Moreno has Getting around first', () => {
    expect(HOME_SECTIONS_BY_TOWN.brookings_sd.beside[0]).toBe('sports');
    expect(HOME_SECTIONS_BY_TOWN.moreno_valley_ca.beside[0]).toBe('getting_around');
  });
});
