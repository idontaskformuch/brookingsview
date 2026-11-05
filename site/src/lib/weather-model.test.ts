import { describe, expect, it } from 'vitest';
import { buildWeatherView, conditionOf, iconFor, rainInsight, uvBand, weekInsight, NEAR_HOURS, WET_POP, type WeatherEnv, type WxInput, type WxPoint } from './weather-model';

const TZ = 'America/Denver';
// Thursday 5 Nov 2026, 14:30 MST (21:30 UTC)
const NOW = new Date('2026-11-05T21:30:00Z');
const fmtHour = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: TZ }).format(d).replace(' ', '').toLowerCase();
const fmtClock = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(d).replace(' ', '').toLowerCase();
const env = (over: Partial<WeatherEnv> = {}): WeatherEnv => ({ now: NOW, tz: TZ, unit: 'F', lat: 39.9205, lon: -105.0866, hourLabel: fmtHour, clock: fmtClock, ...over });

const iso = (ms: number) => new Date(ms).toISOString();
/** n consecutive hourly points starting at `startIso`; `over(i)` adjusts one point. */
function hourly(startIso: string, n: number, over: (i: number) => Partial<WxPoint> = () => ({})): WxPoint[] {
  const t0 = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({ start: iso(t0 + i * 3_600_000), temp: 50 + i, unit: 'F', short: 'Mostly Cloudy', wind: '5 mph', is_daytime: true, ...over(i) }));
}
const H0 = '2026-11-05T21:00:00Z'; // 14:00 MST, the hour we are in at NOW

/** NWS-shaped day/night periods: start at 06:00 / 18:00 MST of each date. */
function periods(rows: { d: number; hi?: number; lo?: number; day?: Partial<WxPoint>; night?: Partial<WxPoint> }[]): WxPoint[] {
  const out: WxPoint[] = [];
  for (const r of rows) {
    const dd = String(r.d).padStart(2, '0');
    if (r.hi !== undefined) out.push({ start: `2026-11-${dd}T06:00:00-07:00`, temp: r.hi, unit: 'F', short: 'Mostly Cloudy', wind: '10 mph NW', is_daytime: true, ...r.day });
    if (r.lo !== undefined) out.push({ start: `2026-11-${dd}T18:00:00-07:00`, temp: r.lo, unit: 'F', short: 'Clear', wind: '5 mph N', is_daytime: false, ...r.night });
  }
  return out;
}
const WEEK = periods([{ d: 5, hi: 54, lo: 31 }, { d: 6, hi: 45, lo: 28 }, { d: 7, hi: 47, lo: 30 }, { d: 8, hi: 50, lo: 33 }, { d: 9, hi: 52, lo: 34 }]);

describe('conditionOf / iconFor', () => {
  it.each([
    ['Sunny', 'clear'], ['Clear', 'clear'], ['Mostly Clear', 'clear'], ['Mostly Sunny', 'clear'],
    ['Partly Cloudy', 'partly'], ['Partly Sunny', 'partly'], ['Mostly Cloudy', 'cloudy'], ['Cloudy', 'cloudy'], ['Overcast', 'cloudy'],
    ['Patchy Fog', 'fog'], ['Mist', 'fog'], ['Areas Of Smoke', 'fog'],
    ['Light rain showers', 'rain'], ['Slight Chance Rain Showers', 'rain'], ['Drizzle', 'rain'],
    ['Light snow', 'snow'], ['Snow Showers', 'snow'], ['Rain And Snow', 'sleet'], ['Freezing Rain', 'sleet'], ['Sleet', 'sleet'], ['Hail', 'sleet'],
    ['Showers And Thunderstorms', 'thunder'], ['Thunder', 'thunder'],
  ])('%s -> %s', (text, cond) => expect(conditionOf(text)).toBe(cond));
  it('says nothing about words it does not know', () => {
    for (const t of ['Windy', '—', '', null, undefined]) expect(conditionOf(t as string)).toBeNull();
  });
  it('night swaps the sun for the moon; unknown conditions get no icon', () => {
    expect(iconFor('clear', true)).toBe('sun');
    expect(iconFor('clear', false)).toBe('moon');
    expect(iconFor('partly', false)).toBe('cloudMoon');
    expect(iconFor('rain', false)).toBe('rain');
    expect(iconFor(null, true)).toBeNull();
  });
});

describe('hero: the forecast for the current hour, labelled', () => {
  const input: WxInput = { periods: WEEK, hourly: hourly(H0, 24, (i) => ({ temp: 48 + i, feels: i === 0 ? 41 : 49 + i })), fetchedAt: '2026-11-05T21:05:00Z' };
  it('uses the hourly point that covers now, in the city unit', () => {
    const v = buildWeatherView(input, env());
    expect(v.hero).toMatchObject({ label: 'Forecast for 2pm', value: 48, unit: 'F', conditions: 'Mostly Cloudy', icon: 'cloud', high: 54, low: 31 });
  });
  it('feels-like only when it differs by 2 or more degrees', () => {
    expect(buildWeatherView(input, env()).hero?.feels).toBe(41);
    const near = buildWeatherView({ ...input, hourly: hourly(H0, 24, () => ({ temp: 48, feels: 47 })) }, env());
    expect(near.hero?.feels).toBeNull();
    const exactly = buildWeatherView({ ...input, hourly: hourly(H0, 24, () => ({ temp: 48, feels: 46 })) }, env());
    expect(exactly.hero?.feels).toBe(46);
  });
  it('no feels field in an old payload: nothing', () => {
    const v = buildWeatherView({ periods: WEEK, hourly: hourly(H0, 24) }, env());
    expect(v.hero?.feels).toBeNull();
  });
  it('without a point for this hour it falls back to today’s high, with the period’s own label', () => {
    const v = buildWeatherView({ periods: WEEK, hourly: hourly('2026-11-05T23:00:00Z', 24) }, env());
    expect(v.hero).toMatchObject({ label: 'Today’s high', value: 54, conditions: 'Mostly Cloudy' });
    expect(v.insights.find((i) => i.id === 'rain')).toBeUndefined();
  });
  it('an evening with only the night period: tonight’s low', () => {
    const eve = new Date('2026-11-06T03:30:00Z'); // 20:30 MST on the 5th
    const afterDay = WEEK.filter((p) => p.start !== '2026-11-05T06:00:00-07:00'); // the forecast no longer lists the day period that is over
    const v = buildWeatherView({ periods: afterDay, hourly: [] }, env({ now: eve }));
    expect(v.hero).toMatchObject({ label: 'Tonight’s low', value: 31, high: null, low: 31 });
    expect(v.days[0]).toMatchObject({ label: 'Tonight', today: true, high: null, low: 31 });
    expect(v.insights).toEqual([]);
  });
  it('nothing at all -> no hero, no days, no insights', () => {
    const v = buildWeatherView({ periods: [], hourly: [] }, env());
    expect(v).toMatchObject({ hero: null, days: [], hours: [], insights: [], scale: null, weekInsight: null, updated: null });
  });
});

describe('days: day and night merged into one row', () => {
  const v = buildWeatherView({ periods: WEEK, hourly: [] }, env());
  it('one row per local date with high from the day period and low from the night period', () => {
    expect(v.days.map((d) => [d.label, d.high, d.low])).toEqual([['Today', 54, 31], ['Fri', 45, 28], ['Sat', 47, 30], ['Sun', 50, 33], ['Mon', 52, 34]]);
    expect(v.days[0].today).toBe(true);
    expect(v.days[1].fullLabel).toBe('Friday');
  });
  it('a shared scale from the coldest low to the warmest high', () => {
    expect(v.scale).toEqual({ min: 28, max: 54 });
  });
  it('drops periods from an earlier local day, and takes the later of two night periods on one date', () => {
    const overnight: WxPoint = { start: '2026-11-05T02:00:00-07:00', temp: 22, unit: 'F', short: 'Clear', wind: null, is_daytime: false };
    const old: WxPoint = { start: '2026-11-04T18:00:00-07:00', temp: 20, unit: 'F', short: 'Clear', wind: null, is_daytime: false };
    const w = buildWeatherView({ periods: [old, overnight, ...WEEK], hourly: [] }, env());
    expect(w.days).toHaveLength(5);
    expect(w.days[0]).toMatchObject({ high: 54, low: 31 });
  });
  it('a row with no temperature at all is not drawn', () => {
    const w = buildWeatherView({ periods: periods([{ d: 5, hi: 54, lo: 31 }, { d: 6 }]).concat({ start: '2026-11-06T06:00:00-07:00', temp: null, short: 'x', wind: null, is_daytime: true }), hourly: [] }, env());
    expect(w.days).toHaveLength(1);
  });
  it('chance of rain: the larger of day and night, per row', () => {
    const w = buildWeatherView({ periods: periods([{ d: 5, hi: 54, lo: 31, day: { pop: 20 }, night: { pop: 70 } }, { d: 6, hi: 45, lo: 28 }]), hourly: [] }, env());
    expect(w.days.map((d) => d.pop)).toEqual([70, null]);
  });
  it('details carry only what exists: wind, gusts, UV, sunrise and sunset', () => {
    const w = buildWeatherView({ periods: periods([{ d: 6, hi: 45, lo: 28, day: { gust: 31, uv: 4, wind: '12 mph NW' }, night: { wind: '12 mph NW' } }]), hourly: [] }, env());
    const d = w.days[0].details;
    expect(d.find((x) => x.label === 'Wind')?.value).toBe('12 mph NW');
    expect(d.find((x) => x.label === 'Gusts')?.value).toBe('up to 31 mph');
    expect(d.find((x) => x.label === 'UV index')?.value).toBe('4 (moderate)');
    expect(d.find((x) => x.label === 'Sunrise')?.value).toMatch(/^\d:\d\dam$/);
    expect(d.find((x) => x.label === 'Sunset')?.value).toMatch(/^\d:\d\dpm$/);
    const bare = buildWeatherView({ periods: periods([{ d: 6, hi: 45, lo: 28, day: { wind: null }, night: { wind: null } }]), hourly: [] }, env()).days[0].details;
    expect(bare.map((x) => x.label)).toEqual(['Sunrise', 'Sunset']);
  });
  it('different day and night winds are both said', () => {
    const w = buildWeatherView({ periods: periods([{ d: 6, hi: 45, lo: 28, day: { wind: '10 mph W' }, night: { wind: '5 mph N' } }]), hourly: [] }, env());
    expect(w.days[0].details[0].value).toBe('10 mph W by day, 5 mph N overnight');
  });
});

describe('UV bands', () => {
  it.each([[0, 'low'], [2, 'low'], [3, 'moderate'], [5, 'moderate'], [6, 'high'], [7, 'high'], [8, 'very high'], [10, 'very high'], [11, 'extreme']])('%i -> %s', (uv, band) => expect(uvBand(uv)).toBe(band));
});

describe('rain timing insight', () => {
  const pt = (i: number, pop: number | undefined, short = 'Mostly Cloudy') => ({ start: iso(Date.parse(H0) + i * 3_600_000), time: fmtHour(new Date(Date.parse(H0) + i * 3_600_000)), pop, short });
  const run = (pops: (number | undefined)[], short?: string) => rainInsight(pops.map((p, i) => pt(i, p, short)), env());
  it('the wet threshold is 50 %', () => {
    expect(WET_POP).toBe(50);
    const dryThenWet = (p: number) => run([...Array(NEAR_HOURS - 1).fill(10), p, ...Array(18).fill(p)]);
    expect(dryThenWet(49)).toBe('Dry for the next 24 hours');
    expect(dryThenWet(50)).toBe(`Dry until 7pm`);
  });
  it('dry now, rain soon: "Dry until"; rain later: "Rain from"', () => {
    expect(run([10, 10, 10, 10, 10, 80, 80, ...Array(17).fill(80)])).toBe('Dry until 7pm');                       // flips at index 5 < 6
    expect(run([10, 10, 10, 10, 10, 10, 80, ...Array(17).fill(80)], 'Light rain')).toBe('Rain from 8pm');       // index 6
    expect(run([10, 10, 10, 10, 10, 10, 80, ...Array(17).fill(80)])).toBe('Precipitation from 8pm');           // pop only, the words name no kind
  });
  it('the noun follows the source’s words', () => {
    expect(run([10, 10, 10, 10, 10, 10, 80, ...Array(17).fill(80)], 'Snow Showers')).toBe('Snow from 8pm');
  });
  it('wet now, dry later: "Rain until"; wet all the way: "for the next N hours"', () => {
    expect(run([80, 80, 80, 10, ...Array(20).fill(10)], 'Light rain')).toBe('Rain until 5pm');
    expect(run(Array(24).fill(80), 'Light rain')).toBe('Rain for the next 24 hours');
  });
  it('a change on the next local day says so', () => {
    expect(run([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 80, 80, 80], 'Light rain')).toBe('Rain from 11am tomorrow');
  });
  it('"dry for the next N hours" needs at least 12 hours of forecast; fewer hours say nothing', () => {
    expect(run(Array(11).fill(0))).toBeNull();
    expect(run(Array(12).fill(0))).toBe('Dry for the next 12 hours');
    expect(run([0])).toBeNull();
    expect(rainInsight([], env())).toBeNull();
  });
  it('without chance-of-rain numbers it reads the words, and "chance" or "slight" is not rain', () => {
    expect(run(Array(24).fill(undefined), 'Chance Rain Showers')).toBe('Dry for the next 24 hours');
    expect(run(Array(24).fill(undefined), 'Light rain')).toBe('Rain for the next 24 hours');
    expect(run(Array(24).fill(undefined), 'Cloudy')).toBe('Dry for the next 24 hours');
  });
  it('is part of the view only with an hourly forecast that covers now', () => {
    const v = buildWeatherView({ periods: WEEK, hourly: hourly(H0, 24, (i) => ({ pop: i < 3 ? 5 : 90, short: 'Rain' })) }, env());
    expect(v.insights[0]).toEqual({ id: 'rain', icon: 'rain', text: 'Dry until 5pm' });
    expect(buildWeatherView({ periods: WEEK, hourly: [] }, env()).insights.map((i) => i.id)).toEqual(['tomorrow']);
  });
});

describe('warmer / colder insights', () => {
  const view = (todayHi: number, tomorrowHi: number, over: Partial<WeatherEnv> = {}) =>
    buildWeatherView({ periods: periods([{ d: 5, hi: todayHi, lo: 30 }, { d: 6, hi: tomorrowHi, lo: 30 }]), hourly: [] }, env(over)).insights;
  it('tomorrow: needs 4 degrees F', () => {
    expect(view(50, 53)).toEqual([]);
    expect(view(50, 54)).toEqual([{ id: 'tomorrow', icon: 'thermometer', text: 'Warmer tomorrow' }]);
    expect(view(50, 46)).toEqual([{ id: 'tomorrow', icon: 'thermometer', text: 'Colder tomorrow' }]);
    expect(view(50, 47)).toEqual([]);
  });
  it('tomorrow: needs 2 degrees C in a Celsius city', () => {
    expect(view(10, 11, { unit: 'C' })).toEqual([]);
    expect(view(10, 12, { unit: 'C' }).map((i) => i.text)).toEqual(['Warmer tomorrow']);
    expect(view(10, 8, { unit: 'C' }).map((i) => i.text)).toEqual(['Colder tomorrow']);
  });
  it('than yesterday, from yesterday’s stored forecast; none stored, none said', () => {
    expect(view(50, 50, { yesterdayHigh: 44 }).map((i) => i.text)).toEqual(['Warmer than yesterday']);
    expect(view(50, 50, { yesterdayHigh: 56 }).map((i) => i.text)).toEqual(['Colder than yesterday']);
    expect(view(50, 50, { yesterdayHigh: 47 })).toEqual([]);
    expect(view(50, 50, { yesterdayHigh: null })).toEqual([]);
    expect(view(50, 50)).toEqual([]);
  });
  it('no tomorrow row, or no high for today, says nothing', () => {
    expect(buildWeatherView({ periods: periods([{ d: 5, hi: 50, lo: 30 }]), hourly: [] }, env()).insights).toEqual([]);
    expect(buildWeatherView({ periods: periods([{ d: 5, lo: 30 }, { d: 6, hi: 60, lo: 30 }]), hourly: [] }, env({ yesterdayHigh: 40 })).insights).toEqual([]);
  });
  it('a gap day does not count as tomorrow', () => {
    expect(buildWeatherView({ periods: periods([{ d: 5, hi: 50, lo: 30 }, { d: 7, hi: 70, lo: 30 }]), hourly: [] }, env()).insights).toEqual([]);
  });
});

describe('same weather several days in a row', () => {
  const d = (label: string, cond: any, today = false) => ({ label, cond, today });
  it('the whole week -> "all week" (5 days or more)', () => {
    expect(weekInsight([d('Tue', 'cloudy'), d('Wed', 'cloudy'), d('Thu', 'cloudy'), d('Fri', 'cloudy'), d('Sat', 'cloudy')])).toBe('Cloudy all week');
  });
  it('4 days all alike is not "all week": it names the days', () => {
    expect(weekInsight([d('Tue', 'cloudy'), d('Wed', 'cloudy'), d('Thu', 'cloudy'), d('Fri', 'cloudy')])).toBe('Cloudy Tue to Fri');
  });
  it('2 days in a row is not a run, 3 is', () => {
    expect(weekInsight([d('Tue', 'rain'), d('Wed', 'rain'), d('Thu', 'clear')])).toBeNull();
    expect(weekInsight([d('Tue', 'clear'), d('Wed', 'rain'), d('Thu', 'rain'), d('Fri', 'rain'), d('Sat', 'clear')])).toBe('Rainy Wed to Fri');
  });
  it('a run that starts today says "until"', () => {
    expect(weekInsight([d('Today', 'snow', true), d('Fri', 'snow'), d('Sat', 'snow'), d('Sun', 'clear')])).toBe('Snowy until Sat');
  });
  it('the longest run wins, the earlier on a tie; unknown weather breaks a run', () => {
    expect(weekInsight([d('A', 'rain'), d('B', 'rain'), d('C', 'rain'), d('D', 'clear'), d('E', 'clear'), d('F', 'clear'), d('G', 'clear')])).toBe('Sunny D to G');
    expect(weekInsight([d('A', 'rain'), d('B', 'rain'), d('C', 'rain'), d('D', 'clear'), d('E', 'clear'), d('F', 'clear')])).toBe('Rainy A to C');
    expect(weekInsight([d('A', 'rain'), d('B', null), d('C', 'rain'), d('D', 'rain')])).toBeNull();
    expect(weekInsight([])).toBeNull();
  });
  it('is read from the day rows of the view', () => {
    const w = buildWeatherView({ periods: WEEK, hourly: [] }, env());
    expect(w.weekInsight).toBe('Cloudy all week');
  });
});

describe('updated', () => {
  it('time only when fetched today, weekday and time otherwise, nothing without fetched_at', () => {
    const base = { periods: WEEK, hourly: [] };
    expect(buildWeatherView({ ...base, fetchedAt: '2026-11-05T21:05:00Z' }, env()).updated).toBe('2:05pm');
    expect(buildWeatherView({ ...base, fetchedAt: '2026-11-04T17:00:00Z' }, env()).updated).toBe('Wed 10:00am');
    expect(buildWeatherView(base, env()).updated).toBeNull();
    expect(buildWeatherView({ ...base, fetchedAt: 'not a date' }, env()).updated).toBeNull();
  });
});

describe('Glasgow-style: Celsius, Met Office wording, optional fields', () => {
  it('works in °C with the Met Office texts', () => {
    const tz = 'Europe/London';
    const now = new Date('2026-11-05T10:20:00Z');
    const ps: WxPoint[] = [
      { start: '2026-11-05T06:00:00Z', temp: 9, unit: 'C', short: 'Light rain', wind: '12 mph SW', is_daytime: true, pop: 90, gust: 30, uv: 1 },
      { start: '2026-11-05T18:00:00Z', temp: 4, unit: 'C', short: 'Partly cloudy', wind: '8 mph W', is_daytime: false, pop: 20 },
      { start: '2026-11-06T06:00:00Z', temp: 6, unit: 'C', short: 'Cloudy', wind: '8 mph W', is_daytime: true },
      { start: '2026-11-06T18:00:00Z', temp: 2, unit: 'C', short: 'Clear', wind: '5 mph W', is_daytime: false },
    ];
    const hs = hourly('2026-11-05T10:00:00Z', 24, (i) => ({ temp: 8, unit: 'C', short: i < 4 ? 'Light rain' : 'Cloudy', pop: i < 4 ? 80 : 10, feels: 5 }));
    const v = buildWeatherView({ periods: ps, hourly: hs, fetchedAt: '2026-11-05T10:00:00Z' }, { now, tz, unit: 'C', lat: 55.8642, lon: -4.2518, hourLabel: (d) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: true, timeZone: tz }).format(d).replace(' ', ''), clock: (d) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(d).replace(' ', '') });
    expect(v.unit).toBe('C');
    expect(v.hero).toMatchObject({ value: 8, unit: 'C', feels: 5, conditions: 'Light rain', icon: 'rain' });
    expect(v.insights[0].text).toBe('Rain until 2pm');
    expect(v.days[0]).toMatchObject({ pop: 90, high: 9, low: 4 });
    expect(v.updated).toBe('10:00am');
  });
});
