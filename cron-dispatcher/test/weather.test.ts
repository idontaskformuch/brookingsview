import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPayload, compass, windText, weatherText, fetchMetOfficeForecast, isAuthFailure, RETRY_DELAYS_MS } from '../src/weather/metoffice';
import { normalizeNws, fetchNwsForecast, mergeGridpoints, isoHours } from '../src/weather/nws';
import { refreshWeather, storeWeather } from '../src/weather/refresh';
import { WEATHER_TOWNS, isWeatherTick } from '../src/weather/towns';

const cfg = (town: string) => JSON.parse(readFileSync(new URL(`../../configs/${town}.json`, import.meta.url), 'utf8'));

describe('weather towns mirror the configs', () => {
  for (const t of WEATHER_TOWNS) {
    it(t.townId, () => {
      const c = cfg(t.townId);
      expect([t.lat, t.lon]).toEqual([c.coordinates.lat, c.coordinates.lon]);
      expect(t.timezone).toBe(c.timezone);
      expect(t.kind).toBe(t.townId === 'glasgow' ? 'metoffice' : 'nws');
    });
  }
});

describe('the forecast job runs on the whole hour only', () => {
  it('minute 0 yes, the other 15-minute ticks no', () => {
    expect(isWeatherTick(Date.parse('2026-10-28T11:00:00Z'))).toBe(true);
    for (const m of ['15', '30', '45']) expect(isWeatherTick(Date.parse(`2026-10-28T11:${m}:00Z`))).toBe(false);
  });
});

describe('Met Office payload equals the Python builder (met_office_site_specific_v1.build_payload)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/met_office_parity.json', import.meta.url), 'utf8'));
  for (const c of fx.cases) {
    it(`now = ${c.now}`, () => {
      expect(buildPayload(fx.hourly, fx.daily, Date.parse(c.now), fx.lat, fx.lon, fx.tz)).toEqual(c.expected);
    });
  }
  it('small helpers behave like the Python ones', () => {
    expect(compass(78.75)).toBe('E'); // 3.5 rounds half-to-even, like Python
    expect(compass(null)).toBe('');
    expect(windText(5, 200)).toBe('11 mph SSW');
    expect(windText(null, 10)).toBe('');
    expect(weatherText(31)).toBe('—');
    expect(weatherText(7)).toBe('Cloudy');
  });
});

describe('NWS payload equals the Python parser (noaa.py NoaaParser.parse)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/nws_parity.json', import.meta.url), 'utf8'));
  it('periods, hourly, pop (kept, null, zero, missing, half-way) and fetched_at', () => {
    const p = normalizeNws(fx.forecast, fx.forecastHourly, Date.parse(fx.now));
    p.hourly = mergeGridpoints(p.hourly, fx.gridpoints);
    expect(p).toEqual(fx.expected);
  });
  it('gridpoints: feels (F from degC), gust (mph from km/h) on every covered hour; none are invented for uncovered hours', () => {
    const h = fx.expected.hourly;
    expect(h.filter((x: any) => 'feels' in x).length).toBeGreaterThan(20);
    expect(h[0]).toMatchObject({ feels: 39, gust: 6 }); // feels in F from the degC series, gust in mph from the km/h series (08:00Z)
  });
  it('no pop key when the source has none, and no fetched_at when the caller gave no time', () => {
    const p = normalizeNws({ properties: { periods: [{ name: 'A', startTime: 'x', temperature: 1, probabilityOfPrecipitation: { value: null } }] } }, { properties: { periods: [] } });
    expect('pop' in p.periods[0]).toBe(false);
    expect('fetched_at' in p).toBe(false);
  });
});

describe('gridpoints merge', () => {
  const hourly = [
    { start: '2026-11-05T10:00:00-07:00', temp: 50, unit: 'F', short: 'x', wind: null, is_daytime: true },
    { start: '2026-11-05T11:00:00-07:00', temp: 52, unit: 'F', short: 'x', wind: null, is_daytime: true },
    { start: '2026-11-05T12:00:00-07:00', temp: 54, unit: 'F', short: 'x', wind: null, is_daytime: true },
  ];
  const grid = { properties: {
    apparentTemperature: { values: [{ validTime: '2026-11-05T17:00:00+00:00/PT2H', value: 10 }] },       // 17Z and 18Z = 10:00 and 11:00 -07:00
    windGust: { values: [{ validTime: '2026-11-05T17:00:00+00:00/PT1H', value: 32.1869 }] },            // 20 mph
    quantitativePrecipitation: { values: [{ validTime: '2026-11-05T17:00:00+00:00/PT1H', value: 0.25 }, { validTime: '2026-11-05T18:00:00+00:00/PT6H', value: 3 }] },
  } };
  it('every hour of an interval gets its value; an hour outside gets nothing', () => {
    const out = mergeGridpoints(hourly, grid);
    expect(out[0]).toMatchObject({ feels: 50, gust: 20, precip_mm: 0.2 });   // 10 degC = 50 F; 0.25 rounds half to even
    expect(out[1].feels).toBe(50);
    expect('gust' in out[1]).toBe(false);
    expect('feels' in out[2]).toBe(false);
  });
  it('a 6-hour amount is not split into hours (no precip_mm), a Celsius payload keeps degC', () => {
    expect('precip_mm' in mergeGridpoints(hourly, grid)[1]).toBe(false);
    expect(mergeGridpoints([{ ...hourly[0], unit: 'C' }], grid)[0].feels).toBe(10);
  });
  it('no gridpoints, an empty answer or a point without a usable time changes nothing', () => {
    expect(mergeGridpoints(hourly, null)).toEqual(hourly);
    expect(mergeGridpoints(hourly, { properties: {} })).toEqual(hourly);
    expect(mergeGridpoints([{ ...hourly[0], start: null }], grid)).toEqual([{ ...hourly[0], start: null }]);
  });
  it('ISO durations', () => {
    expect([isoHours('PT1H'), isoHours('PT6H'), isoHours('P1DT6H'), isoHours('P1D'), isoHours('PT30M'), isoHours('')]).toEqual([1, 6, 30, 24, null, null]);
  });
  it('fetchNwsForecast asks forecastGridData too, and survives it failing', async () => {
    const make = (gridStatus: number) => (async (u: any) => {
      const url = String(u);
      if (url.includes('/points/')) return new Response(JSON.stringify({ properties: { forecast: 'https://x/f', forecastHourly: 'https://x/h', forecastGridData: 'https://x/g' } }));
      if (url.endsWith('/g')) return new Response(JSON.stringify(grid), { status: gridStatus });
      return new Response(JSON.stringify({ properties: { periods: [{ name: 'A', startTime: '2026-11-05T10:00:00-07:00', temperature: 50, temperatureUnit: 'F', shortForecast: 'x', windSpeed: '5 mph', isDaytime: true }] } }));
    }) as typeof fetch;
    expect((await fetchNwsForecast(1, 2, make(200), Date.parse('2026-11-05T17:05:00Z'))).hourly[0]).toMatchObject({ feels: 50, gust: 20 });
    const failed = await fetchNwsForecast(1, 2, make(500), Date.parse('2026-11-05T17:05:00Z'));
    expect(failed.periods).toHaveLength(1);
    expect('feels' in failed.hourly[0]).toBe(false);
    expect(failed.fetched_at).toBe('2026-11-05T17:05:00Z');
  });
});

describe('NWS', () => {
  const forecast = { properties: { periods: Array.from({ length: 16 }, (_, i) => ({ name: `P${i}`, startTime: `2026-10-28T${String(i).padStart(2, '0')}:00:00-05:00`, temperature: 40 + i, temperatureUnit: 'F', shortForecast: 'Cloudy', windSpeed: '10 mph', isDaytime: i % 2 === 0 })) } };
  const hourly = { properties: { periods: Array.from({ length: 30 }, (_, i) => ({ name: '', startTime: `h${i}`, temperature: 50, temperatureUnit: 'F', shortForecast: 'Fog', windSpeed: '5 mph', isDaytime: false })) } };
  it('normalises like noaa.py: 14 periods, 24 hours, hourly without name', () => {
    const p = normalizeNws(forecast, hourly);
    expect(p.periods).toHaveLength(14);
    expect(p.hourly).toHaveLength(24);
    expect(p.periods[0]).toEqual({ name: 'P0', start: '2026-10-28T00:00:00-05:00', temp: 40, unit: 'F', short: 'Cloudy', wind: '10 mph', is_daytime: true });
    expect('name' in p.hourly[0]).toBe(false);
  });
  it('asks /points first, then both forecast URLs, and refuses a bad answer', async () => {
    const urls: string[] = [];
    const fetcher = (async (u: any) => {
      urls.push(String(u));
      if (String(u).includes('/points/')) return new Response(JSON.stringify({ properties: { forecast: 'https://x/f', forecastHourly: 'https://x/h' } }));
      return new Response(JSON.stringify(String(u).endsWith('/h') ? hourly : forecast));
    }) as typeof fetch;
    const p = await fetchNwsForecast(44.3, -96.8, fetcher);
    expect(urls[0]).toContain('https://api.weather.gov/points/44.3,-96.8');
    expect(urls.slice(1).sort()).toEqual(['https://x/f', 'https://x/h']);
    expect(p.periods.length).toBe(14);
    await expect(fetchNwsForecast(1, 2, (async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow('HTTP 503');
  });
});

function fakeSql() {
  const calls: { text: string; values: any[] }[] = [];
  const sql = (async (s: TemplateStringsArray, ...values: any[]) => { calls.push({ text: s.join('?').replace(/\s+/g, ' ').trim(), values }); return []; }) as any;
  return { sql, calls };
}

describe('storeWeather / refreshWeather', () => {
  it('updates the day row in place (UTC date, like noaa.py)', async () => {
    const { sql, calls } = fakeSql();
    await storeWeather(sql, 'brookings_sd', { periods: [], hourly: [] }, Date.parse('2026-10-28T23:30:00Z'));
    expect(calls[0].text).toContain('ON CONFLICT (town_id, observed_for) DO UPDATE SET payload = EXCLUDED.payload');
    expect(calls[0].values[1]).toBe('2026-10-28');
  });
  it('a failing town writes nothing and does not stop the next; Glasgow without its key fails loudly', async () => {
    const { sql, calls } = fakeSql();
    const towns = [WEATHER_TOWNS[0], WEATHER_TOWNS[3]];
    const res = await refreshWeather({ DATABASE_URL: 'x' }, { sql, towns, fetcher: (async () => new Response('', { status: 500 })) as typeof fetch });
    expect(res.map((r) => r.ok)).toEqual([false, false]);
    expect(res[1].error).toContain('MET_OFFICE_API_KEY');
    expect(calls).toEqual([]);
  });
});

describe('Met Office retries and error text', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/met_office_parity.json', import.meta.url), 'utf8'));
  const now = Date.parse('2026-10-28T09:30:00Z');
  const ok = (doc: unknown) => new Response(JSON.stringify(doc), { status: 200 });

  it('keeps patient delays for the whole-hour publication window', () => {
    expect(RETRY_DELAYS_MS).toEqual([5000, 15000, 30000]);
  });
  it('a 500 followed by a good answer succeeds, and the key never leaves the apikey header', async () => {
    const calls: { url: string; h: Record<string, string> }[] = [];
    const fetcher = (async (u: any, init: any) => {
      calls.push({ url: String(u), h: init.headers });
      const hourlyCalls = calls.filter((c) => c.url.includes('/hourly')).length;
      if (String(u).includes('/hourly')) return hourlyCalls === 1 ? new Response('upstream broke', { status: 500 }) : ok(fx.hourly);
      return ok(fx.daily);
    }) as typeof fetch;
    const p = await fetchMetOfficeForecast(55.86, -4.25, 'Europe/London', 'secret-key', fetcher, now, [0, 0, 0]);
    expect(p.periods.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.url.includes('/hourly'))).toHaveLength(2);
    for (const c of calls) { expect(c.url).not.toContain('secret-key'); expect(c.h.apikey).toBe('secret-key'); }
  });
  it('after the last retry the error carries status, attempts and the start of the body', async () => {
    const fetcher = (async () => new Response('{"code":"500","message":"Internal   error from gateway"}', { status: 500, headers: { via: '1.1 cloudfront', 'content-type': 'application/json' } })) as typeof fetch;
    await expect(fetchMetOfficeForecast(55.86, -4.25, 'Europe/London', 'secret-key', fetcher, now, [0, 0, 0])).rejects.toThrow(
      /Met Office hourly -> HTTP 500 after 4 attempts; body: \{"code":"500","message":"Internal error from gateway"\}; content-type=application\/json via=1\.1 cloudfront/);
  });
  it('HTTP 500 with the gateway auth code 900900 is an auth failure: logged as such and NOT retried', async () => {
    let n = 0;
    const fetcher = (async () => { n++; return new Response('{"code":"900900","message":"Unclassified Authentication Failure"}', { status: 500, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    await expect(fetchMetOfficeForecast(55.86, -4.25, 'Europe/London', 'k', fetcher, now, [0, 0, 0])).rejects.toThrow(/auth failure \(HTTP 500, not retried\): check MET_OFFICE_API_KEY/);
    expect(n).toBe(1);
  });
  it('isAuthFailure: 401/403 and any 9009xx code, but not a plain 5xx', () => {
    expect(isAuthFailure(401, '')).toBe(true);
    expect(isAuthFailure(403, 'x')).toBe(true);
    expect(isAuthFailure(500, '{"code":"900900"}')).toBe(true);
    expect(isAuthFailure(500, '{"code":900901,"message":"Invalid Credentials"}')).toBe(true);
    expect(isAuthFailure(503, 'upstream timeout')).toBe(false);
    expect(isAuthFailure(500, '{"code":"500","message":"boom"}')).toBe(false);
  });
  it('a real 5xx without an auth code is still retried', async () => {
    let n = 0;
    await expect(fetchMetOfficeForecast(1, 2, 'Europe/London', 'k', (async () => { n++; return new Response('{"code":"500"}', { status: 502 }); }) as typeof fetch, now, [0, 0])).rejects.toThrow('HTTP 502 after 3 attempts');
    expect(n).toBe(3);
  });
  it('a 4xx is not retried and a network error is', async () => {
    let n = 0;
    await expect(fetchMetOfficeForecast(1, 2, 'Europe/London', 'k', (async () => { n++; return new Response('nope', { status: 404 }); }) as typeof fetch, now, [0, 0, 0])).rejects.toThrow('HTTP 404 after 1 attempt;');
    expect(n).toBe(1);
    let m = 0;
    await expect(fetchMetOfficeForecast(1, 2, 'Europe/London', 'k', (async () => { m++; throw new Error('connection reset'); }) as typeof fetch, now, [0, 0])).rejects.toThrow('network error after 3 attempts: connection reset');
    expect(m).toBe(3);
  });
  it('refreshWeather passes its retry delays through, and the message ends up in the town result', async () => {
    const sql = (async () => []) as any;
    const res = await refreshWeather({ DATABASE_URL: 'x', MET_OFFICE_API_KEY: 'k' }, {
      sql, towns: [WEATHER_TOWNS[3]], retryDelaysMs: [0], fetcher: (async () => new Response('bad', { status: 502 })) as typeof fetch });
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toContain('HTTP 502 after 2 attempts; body: bad');
  });
});
