import { describe, expect, it } from 'vitest';
import { todayDescription, todayModules, todayShows, todaySources } from './today-copy';
import { ALL_CONFIGS } from './site-config';

const by = (id: string) => ALL_CONFIGS.find((c) => c.townId === id)!;

describe('/today copy only promises what the town has', () => {
  it('Glasgow: warnings and events, no school status, no road conditions', () => {
    const g = by('glasgow');
    expect(todayModules(g)).toEqual(['weather warnings', 'events today and tomorrow']);
    expect(todayShows(g, 'Glasgow')).toBe('What matters in Glasgow right now: weather warnings and events today and tomorrow.');
    expect(todayDescription(g, 'Glasgow')).not.toMatch(/school|road|traffic/i);
    expect(todaySources(g)).toBe('Met Office warnings and event organisers\' own calendars');
  });
  it('a US town with closure watch and a traffic source keeps all four promises', () => {
    const us = { country: 'us', hasClosureWatch: true, trafficSource: { name: 'x', url: 'https://x.test', scopeNote: '' } } as const;
    expect(todayModules(us)).toEqual(['weather alerts', 'school status', 'road conditions', 'events today and tomorrow']);
    expect(todaySources(us)).toBe("National Weather Service alerts, local school and road-condition sources and event organizers' own calendars");
    expect(todaySources({ country: 'us', hasClosureWatch: true })).toBe("National Weather Service alerts, local school sources and event organizers' own calendars");
  });
  it('every town: no module is promised without its flag', () => {
    for (const c of ALL_CONFIGS) {
      const text = todayShows(c, c.cityName);
      expect(/school status/.test(text)).toBe(!!c.hasClosureWatch);
      expect(/road conditions/.test(text)).toBe(!!c.trafficSource);
    }
  });
});
