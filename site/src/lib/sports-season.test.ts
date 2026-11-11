// /sports off-season rules (owner 2026-11-11): 14-day window, latest recap with its age, last 10 finished games per team.
import { describe, expect, it } from 'vitest';
import { ageLabel, nextOpenGame, seasonStatus, splitTeamGames, ymd, type SeasonGame } from './sports-season';

const g = (game_date: string, status = 'final'): SeasonGame => ({ game_date, status, team_name: '66ers', opponent_name: 'Opp', home_away: 'home' });

describe('seasonStatus', () => {
  const today = '2026-11-10';
  it('is off-season when nothing is scheduled', () => {
    expect(seasonStatus([g('2026-10-01'), g('2026-10-02')], today)).toEqual({ offSeason: true, next: null });
  });
  it('is off-season when the next game is more than 14 days away, and names it', () => {
    const next = g('2027-03-28', 'scheduled');
    const s = seasonStatus([g('2026-10-01'), next], today);
    expect(s.offSeason).toBe(true);
    expect(s.next).toBe(next);
  });
  it('is in season when a game is scheduled within 14 days (day 14 counts, day 15 does not)', () => {
    expect(seasonStatus([g('2026-11-24', 'scheduled')], today).offSeason).toBe(false);
    expect(seasonStatus([g('2026-11-25', 'scheduled')], today).offSeason).toBe(true);
    expect(seasonStatus([g('2026-11-10', 'live')], today).offSeason).toBe(false);
  });
  it('ignores postponed and past games when finding the next one', () => {
    expect(nextOpenGame([g('2026-11-12', 'postponed'), g('2026-11-01', 'scheduled')], today)).toBeNull();
  });
});

describe('game_date shapes', () => {
  it('accepts a Date built from local y/m/d as well as a string (the driver returns both)', () => {
    expect(ymd(new Date(2026, 10, 5))).toBe('2026-11-05');
    expect(ymd('2026-11-05')).toBe('2026-11-05');
    const dateGame: SeasonGame = { ...g('x', 'scheduled'), game_date: new Date(2027, 2, 28) };
    expect(seasonStatus([dateGame], '2026-11-10')).toEqual({ offSeason: true, next: dateGame });
  });
});

describe('ageLabel', () => {
  it('reads like a person would say it', () => {
    expect(ageLabel('2026-11-10', '2026-11-10')).toBe('today');
    expect(ageLabel('2026-11-10', '2026-11-09')).toBe('yesterday');
    expect(ageLabel('2026-11-10', '2026-11-03')).toBe('7 days ago');
    expect(ageLabel('2026-11-10', '2026-10-19')).toBe('3 weeks ago');
    expect(ageLabel('2026-11-10', '2026-08-01')).toBe('3 months ago');
  });
});

describe('splitTeamGames', () => {
  const finals = Array.from({ length: 14 }, (_, i) => g(`2026-09-${String(i + 1).padStart(2, '0')}`));
  it('keeps the last 10 finished games and every game still to come; folds the older ones', () => {
    const upcoming = [g('2027-03-28', 'scheduled'), g('2026-10-05', 'postponed')];
    const { shown, earlier } = splitTeamGames([...finals, ...upcoming]);
    expect(earlier).toEqual(finals.slice(0, 4));
    expect(shown).toEqual([...finals.slice(4), ...upcoming]);
  });
  it('folds nothing when there are 10 or fewer finished games', () => {
    expect(splitTeamGames(finals.slice(0, 10)).earlier).toEqual([]);
  });
});
