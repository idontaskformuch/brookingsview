import { describe, expect, it } from 'vitest';
import { planRail, RAIL_FIRST_SCREEN_REM, RAIL_HEIGHT_REM } from './rail';
import { HOME_RAIL_BY_TOWN, homeRailFor, type RailConfig } from '../config/home-rail';
import { ALL_CONFIGS } from './site-config';

const cfg: RailConfig = { modules: ['meeting', 'holiday', 'sport', 'numbers', 'weather', 'traffic'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } };

describe('planRail', () => {
  it('hides a module without data and keeps config order', () => {
    const p = planRail(cfg, { weather: true, meeting: true, sport: false, holiday: true, numbers: true });
    expect(p.modules).toEqual(['meeting', 'holiday', 'numbers', 'weather']);
  });
  it('no data at all gives an empty plan (the page then renders no rail, never an empty box)', () => {
    expect(planRail(cfg, {}).modules).toEqual([]);
  });
  it('the reserve fills in only while the rail is shorter than the first screen', () => {
    const short = planRail(cfg, { meeting: true, meetings_more: true });
    expect(RAIL_HEIGHT_REM.meeting).toBeLessThan(RAIL_FIRST_SCREEN_REM);
    expect(short.modules).toEqual(['meeting', 'meetings_more']);
    const tall = planRail(cfg, { meeting: true, holiday: true, sport: true, numbers: true, weather: true, meetings_more: true });
    expect(tall.modules).not.toContain('meetings_more');
  });
  it('Right Now counts toward the height when the rail opens with it', () => {
    const avail = { meeting: true, holiday: true, weather: true, meetings_more: true };
    expect(planRail(cfg, avail).modules).toContain('meetings_more');
    expect(planRail(cfg, avail, { withStatus: true }).modules).not.toContain('meetings_more');
  });
  it('a reserve module without data is skipped', () => {
    expect(planRail(cfg, { meeting: true }).modules).toEqual(['meeting']);
  });
  it('the ad slot follows the configured module among those shown, and is dropped past the end', () => {
    expect(planRail(cfg, { meeting: true, weather: true, traffic: true }).adAfter).toBe(2);
    expect(planRail(cfg, { meeting: true }).adAfter).toBeNull();
    expect(planRail({ ...cfg, adSlot: undefined }, { meeting: true, weather: true }).adAfter).toBeNull();
  });
});

describe('config/home-rail.ts', () => {
  it('every town has a rail config, and no module is listed twice', () => {
    for (const c of ALL_CONFIGS) {
      const r = homeRailFor(c.townId);
      const all = [...r.modules, ...r.reserve];
      expect(new Set(all).size, c.townId).toBe(all.length);
    }
  });
  it('the spec order (meeting, holiday, sport, numbers, weather) opens every rail', () => {
    for (const r of Object.values(HOME_RAIL_BY_TOWN)) expect(r.modules.slice(0, 5)).toEqual(['meeting', 'holiday', 'sport', 'numbers', 'weather']);
  });
});

// ---- data rules, real rows (CLAUDE.md #15) ----
import { railMeetings, nextRailHoliday, latestFinal, scoreLine, RAIL_HOLIDAY_DAYS } from './rail';
import { frontPageHolidays } from './front-page-holidays';

/** Broomfield meetings ids 11825, 11824, 12328 (meetings table, read 2026-11-19), as the view sees them; only the fields the rule reads. */
const bmf = (o: Record<string, unknown>) => ({ items: [], agendaUrl: 'https://broomfield.legistar.com/', quorumNotice: false, cancelled: false, postponed: false, closed: false, collapsedGroup: null, ...o }) as any;
const BROOMFIELD = [
  bmf({ id: 11825, bodyLabel: 'City Council Transition Meeting', ymd: '2026-12-01' }),
  bmf({ id: 11824, bodyLabel: 'City Council Regular Meeting', ymd: '2026-12-01' }),
  bmf({ id: 12328, bodyLabel: 'City Council Regular Meeting', ymd: '2026-12-08' }),
];

describe('railMeetings', () => {
  it('the next attendable meeting, then the ones after it', () => {
    const r = railMeetings(BROOMFIELD, '2026-11-19');
    expect(r.next?.id).toBe(11825);
    expect(r.more.map((m) => m.id)).toEqual([11824, 12328]);
  });
  it('skips a meeting the page already features, and a cancelled one (11825 with only cancelled changed)', () => {
    expect(railMeetings(BROOMFIELD, '2026-11-19', new Set(['11825'])).next?.id).toBe(11824);
    expect(railMeetings([{ ...BROOMFIELD[0], cancelled: true }, ...BROOMFIELD.slice(1)], '2026-11-19').next?.id).toBe(11824);
  });
  it('nothing more than 45 days out', () => {
    expect(railMeetings(BROOMFIELD, '2026-10-01').next).toBeNull();
  });
});

describe('nextRailHoliday (config/holiday-pages, Broomfield 2026)', () => {
  const DAY = 86_400_000;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
  const hs = frontPageHolidays('broomfield_co', 2026);
  it('the soonest holiday page ahead, with days away', () => {
    const h = nextRailHoliday(hs, day('2026-11-19'));
    expect(h?.slug).toBe('thanksgiving');
    expect(h?.daysAway).toBe(7);
  });
  it('skips the holiday the page already shows', () => {
    expect(nextRailHoliday(hs, day('2026-11-19'), new Set(['thanksgiving']))?.slug).toBe('christmas');
  });
  it(`nothing beyond ${RAIL_HOLIDAY_DAYS} days`, () => {
    const h = nextRailHoliday(hs, day('2026-11-19'));
    expect(h!.daysAway).toBeLessThanOrEqual(RAIL_HOLIDAY_DAYS);
  });
});

describe('latestFinal + scoreLine (Moreno Valley regional_sports_games, read 2026-11-19)', () => {
  const g = (game_date: string, team_score: number, opponent_score: number) => ({
    league: 'mlb', team_name: 'Los Angeles Angels', opponent_name: 'Seattle Mariners', home_away: 'away', game_date, status: 'final', team_score, opponent_score,
  });
  const rows = [g('2026-09-26', 4, 8), g('2026-09-27', 3, 7), g('2026-09-25', 7, 5)];
  it('the latest final inside the window', () => {
    expect(latestFinal(rows, '2026-09-30')?.game_date).toBe('2026-09-27');
  });
  it('an off-season team has no result in the rail (19 Nov: the last final is 27 Sep)', () => {
    expect(latestFinal(rows, '2026-11-19')).toBeNull();
  });
  it('W/L and the draw letter from the country profile', () => {
    expect(scoreLine(3, 7, 'T')).toBe('L 3-7');
    expect(scoreLine(7, 5, 'T')).toBe('W 7-5');
    expect(scoreLine(1, 1, 'D')).toBe('D 1-1');
  });
});
