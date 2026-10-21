import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ELECTION_BY_TOWN } from '../config/election';
import {
  assertElectionValid, daysBetween, formatYmd, isPastNoindexWindow, leadSentence, statusFor, todayIn,
  type ElectionConfig,
} from './election';

const clone = (c: ElectionConfig): ElectionConfig => JSON.parse(JSON.stringify(c));
const TOWNS = Object.keys(ELECTION_BY_TOWN);

describe('election config (build gate)', () => {
  it.each(TOWNS)('%s: every date, place and link is sourced on an official host', (town) => {
    expect(() => assertElectionValid(town, ELECTION_BY_TOWN[town])).not.toThrow();
  });

  it.each(TOWNS)('%s: removing a key date source fails loudly', (town) => {
    const c = clone(ELECTION_BY_TOWN[town]);
    (c.key_dates[0] as { source_url?: string }).source_url = '';
    expect(() => assertElectionValid(town, c)).toThrow(/key_dates\[.*no source_url/);
  });

  it.each(TOWNS)('%s: a place without a source fails', (town) => {
    const c = clone(ELECTION_BY_TOWN[town]);
    if (c.places.length === 0) return;
    (c.places[0] as { source_url?: string }).source_url = '';
    expect(() => assertElectionValid(town, c)).toThrow(/places\[.*no source_url/);
  });

  it('a source that is not listed in sources fails', () => {
    const c = clone(ELECTION_BY_TOWN.broomfield_co);
    c.key_dates[0].source_url = 'https://www.broomfield.org/9999/Unlisted';
    expect(() => assertElectionValid('broomfield_co', c)).toThrow(/not listed in sources/);
  });

  it('a third-party host is rejected (official sources only)', () => {
    const c = clone(ELECTION_BY_TOWN.broomfield_co);
    c.sample_ballot = { label: 'x', url: 'https://ballotpedia.org/x', source_url: c.sources[0].url };
    expect(() => assertElectionValid('broomfield_co', c)).toThrow(/official host/);
  });

  it('a non-https URL is rejected', () => {
    const c = clone(ELECTION_BY_TOWN.broomfield_co);
    c.authority.url = 'http://broomfield.org/4369/Election-Information';
    expect(() => assertElectionValid('broomfield_co', c)).toThrow(/official host/);
  });

  it('a malformed date fails', () => {
    const c = clone(ELECTION_BY_TOWN.broomfield_co);
    c.key_dates[0].date = '10/02/2026';
    expect(() => assertElectionValid('broomfield_co', c)).toThrow(/YYYY-MM-DD/);
  });

  it('no data leaks between towns', () => {
    const text = (t: string) => JSON.stringify(ELECTION_BY_TOWN[t]);
    expect(text('broomfield_co')).not.toMatch(/Riverside|Moreno|Brookings|sdsos/);
    expect(text('moreno_valley_ca')).not.toMatch(/Broomfield|Brookings|sdsos|coloradosos/);
    expect(text('brookings_sd')).not.toMatch(/Broomfield|Riverside|Moreno|coloradosos/);
  });

  it('Broomfield keeps the last recommended mail day (26 Oct) as a prominent row', () => {
    const row = ELECTION_BY_TOWN.broomfield_co.key_dates.find((d) => d.date === '2026-10-26');
    expect(row?.prominent).toBe(true);
    expect(row?.label).toMatch(/Last recommended day to mail/);
  });

  it('election page and config contain no model calls', () => {
    const files = ['../pages/vote.astro', '../config/election.ts', './election.ts'];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/anthropic|openai|ai_pipeline|generateText|fetch\(/i);
    }
  });
});

describe('election date helpers', () => {
  it('daysBetween counts calendar days, across a DST change', () => {
    expect(daysBetween('2026-10-21', '2026-11-03')).toBe(13);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-04', '2026-11-03')).toBe(-1);
  });

  it('passed dates are never reported as upcoming', () => {
    expect(statusFor('2026-10-21', '2026-10-19')).toBe('passed');
    expect(statusFor('2026-10-21', '2026-10-21')).toBe('today');
    expect(statusFor('2026-10-21', '2026-10-26')).toBe('upcoming');
  });

  it('todayIn uses the town timezone, not UTC', () => {
    const t = new Date('2026-11-04T03:30:00Z'); // 8:30 pm on 3 Nov in Denver / LA, still 3 Nov
    expect(todayIn('America/Denver', t)).toBe('2026-11-03');
    expect(todayIn('America/Los_Angeles', t)).toBe('2026-11-03');
    expect(todayIn('UTC', t)).toBe('2026-11-04');
  });

  it('lead sentence: days left, tomorrow, today, over', () => {
    expect(leadSentence('2026-10-21', '2026-11-03', 'Broomfield')).toBe('Election Day in Broomfield is Tuesday, November 3, 2026, 13 days from today.');
    expect(leadSentence('2026-11-02', '2026-11-03', 'Broomfield')).toContain('is tomorrow');
    expect(leadSentence('2026-11-03', '2026-11-03', 'Broomfield')).toContain('Today is Election Day');
    expect(leadSentence('2026-11-04', '2026-11-03', 'Broomfield')).toContain('It is over.');
  });

  it('formatYmd gives the right weekday', () => {
    expect(formatYmd('2026-10-26')).toBe('Monday, October 26');
    expect(formatYmd('2026-11-03', true)).toBe('Tuesday, November 3, 2026');
  });

  it('noindex window starts 30 days after the election', () => {
    expect(isPastNoindexWindow('2026-12-03', '2026-11-03')).toBe(false);
    expect(isPastNoindexWindow('2026-12-04', '2026-11-03')).toBe(true);
  });
});

import { buildElectionStatus, zonedInstant } from './election';
describe('zonedInstant', () => {
  it('maps local wall-clock to UTC across DST/standard time', () => {
    expect(zonedInstant('2026-11-03', '20:00', 'America/Denver').toISOString()).toBe('2026-11-04T03:00:00.000Z');
    expect(zonedInstant('2026-11-03', '20:00', 'America/Los_Angeles').toISOString()).toBe('2026-11-04T04:00:00.000Z');
    expect(zonedInstant('2026-11-03', '20:00', 'America/Chicago').toISOString()).toBe('2026-11-04T02:00:00.000Z');
  });
});
describe('CityStatus election row', () => {
  it('shows "Election Day: Tue Nov 3 · How to vote" before 20:00 on Election Day, with a swap instant', () => {
    const r = buildElectionStatus('2026-11-03', 'America/Denver', new Date('2026-10-21T18:00:00Z'));
    expect(r?.value).toBe('Election Day: Tue Nov 3 · How to vote');
    expect(r?.then).toEqual({ at: '2026-11-04T03:00:00.000Z', value: 'Results: unofficial · see results', href: '/election-results/' });
    expect(buildElectionStatus('2026-11-03', 'America/Denver', new Date('2026-11-03T20:00:00Z'))?.value).toMatch(/^Election Day/);
  });
  it('turns into the results row from 20:00 local on Election Day, and the day after', () => {
    const at = buildElectionStatus('2026-11-03', 'America/Denver', new Date('2026-11-04T03:00:00Z'));
    expect(at).toMatchObject({ value: 'Results: unofficial · see results', href: '/election-results/' });
    expect(at?.then).toBeUndefined();
    expect(buildElectionStatus('2026-11-03', 'America/Denver', new Date('2026-11-05T18:00:00Z'))?.href).toBe('/election-results/');
  });
  it('is omitted (null) after the results window', () => {
    expect(buildElectionStatus('2026-11-03', 'America/Denver', new Date('2026-12-05T18:00:00Z'))).toBeNull();
  });
});
