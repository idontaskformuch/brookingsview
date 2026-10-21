import { describe, expect, it } from 'vitest';
import { pickSignGame, signGameText, type SignGame } from './sign-game';

const CHI = 'America/Chicago';
// Brookings' real rows around Hobo Day 2026 (starts_at in UTC; CDT = UTC-5)
const g = (sport: string, opponent: string, home_away: string, starts_at: string): SignGame => ({ sport, opponent, home_away, starts_at });
const VB_USD = g('volleyball', 'South Dakota', 'home', '2026-10-24T00:00:00Z');     // Fri Oct 23 19:00
const FB_MSU = g('football', 'Murray State', 'home', '2026-10-24T19:00:00Z');       // Sat Oct 24 14:00 (Hobo Day)
const WBB_EX = g('wbb', 'St. Cloud State (Exhibition)', 'home', '2026-10-29T00:00:00Z');
const FB_USD = g('football', 'South Dakota', 'home', '2026-10-31T20:00:00Z');
const AWAY_VB = g('volleyball', 'Oral Roberts', 'away', '2026-11-05T17:00:00Z');
const ALL = [VB_USD, FB_MSU, WBB_EX, FB_USD, AWAY_VB];

describe('pickSignGame', () => {
  it('Tue Oct 20: football on Hobo Day beats the earlier volleyball match', () => {
    expect(pickSignGame(ALL, new Date('2026-10-20T19:00:00Z'), CHI)).toBe(FB_MSU);
  });
  it('the day after Hobo Day: the next football game within 7 days is USD on Oct 31', () => {
    expect(pickSignGame(ALL, new Date('2026-10-25T15:00:00Z'), CHI)).toBe(FB_USD);
  });
  it('no football within 7 days: the nearest home game, not an earlier away one', () => {
    const games = [g('mbb', 'Kansas State', 'away', '2026-11-04T01:00:00Z'), g('wbb', 'Creighton', 'home', '2026-11-04T01:00:00Z')];
    expect(pickSignGame(games, new Date('2026-11-01T18:00:00Z'), CHI)).toBe(games[1]);
  });
  it('nothing near: the next game, whatever it is', () => {
    expect(pickSignGame([AWAY_VB], new Date('2026-10-20T19:00:00Z'), CHI)).toBe(AWAY_VB);
  });
  it('past games are ignored; none left returns null', () => {
    expect(pickSignGame(ALL, new Date('2027-01-01T00:00:00Z'), CHI)).toBeNull();
  });
  it('the 7-day window counts town calendar days, not 24-hour blocks', () => {
    // Fri Oct 23 23:30 CDT -> Fri Oct 30 is 7 days away; a football game Sat Oct 31 is 8
    const fb = g('football', 'X', 'home', '2026-11-01T01:00:00Z'); // Sat Oct 31 20:00 CDT
    const away = g('volleyball', 'Y', 'home', '2026-10-31T01:00:00Z'); // Fri Oct 30 20:00 CDT
    expect(pickSignGame([away, fb], new Date('2026-10-24T04:30:00Z'), CHI)).toBe(away);
  });
});

describe('signGameText', () => {
  it('names the sport and shortens the rival', () => {
    expect(signGameText(VB_USD)).toBe('Jacks volleyball vs USD');
    expect(signGameText(FB_MSU)).toBe('Jacks football vs Murray State');
    expect(signGameText(AWAY_VB)).toBe('Jacks volleyball at Oral Roberts');
    expect(signGameText(g('wbb', 'No. 3 South Dakota', 'neutral', '2026-03-07T14:30:00Z'))).toBe("Jacks women's basketball vs USD");
    expect(signGameText(g('mbb', 'Kansas State', 'away', '2026-11-04T01:00:00Z'))).toBe("Jacks men's basketball at Kansas State");
  });
});
