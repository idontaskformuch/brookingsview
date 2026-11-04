import { describe, expect, it } from 'vitest';
import { lastUpdatedLabel, progressRow, endpointFor, metaLine, precinctsLine, turnoutLine, viewState, type ResultsPayload } from './election-results';

const base: ResultsPayload = { available: true, town: 'brookings_sd', electionDate: '2026-11-03', phase: 'night', unofficial: true };

describe('election-results helpers', () => {
  it('uses a town-less endpoint (the Worker reads the hostname)', () => {
    expect(endpointFor()).toBe('/api/election-results');
  });
  it('meta line has source, source time and fetch time, and says Unofficial', () => {
    const l = metaLine({ ...base, sourceUpdatedAt: '9:05 PM CT', fetchedAt: '2026-11-04T03:07:00Z' }, 'South Dakota Secretary of State', 'America/Chicago');
    expect(l).toBe('Unofficial results · Updated by South Dakota Secretary of State at 9:05 PM CT · Fetched at Nov 3, 9:07 PM CST');
  });
  it('meta line copes with a source that gives no timestamp', () => {
    expect(metaLine({ ...base, fetchedAt: '2026-11-04T03:07:00Z' }, 'X', 'America/Chicago')).toMatch(/^Unofficial results · Updated by X · Fetched at /);
  });
  it('view states: results, waiting before polls close, unreachable, done', () => {
    const c = [{ id: '1', name: 'n', choices: [{ name: 'a', votes: 1, pct: 100 }] }];
    expect(viewState({ ...base, contests: c })).toEqual({ kind: 'results' });
    expect(viewState({ ...base, available: false, phase: 'before' })).toEqual({ kind: 'waiting', text: 'Results will appear after polls close.' });
    expect(viewState({ ...base, available: false, phase: 'night' }).kind).toBe('waiting');
    expect(viewState({ ...base, available: false, phase: 'done' }).kind).toBe('unavailable');
    expect(viewState(null).kind).toBe('unavailable');
  });
  it('precinct and turnout lines', () => {
    expect(precinctsLine({ ...base, precincts: { reported: 5, total: 686 } })).toBe('5 of 686 precincts reporting');
    expect(precinctsLine(base)).toBeNull();
    expect(turnoutLine({ ...base, turnout: { ballotsCounted: 22906, registered: 56478 } })).toBe('22,906 ballots counted of 56,478 registered voters');
    expect(turnoutLine({ ...base, turnout: { ballotsCounted: null, registered: null } })).toBeNull();
    expect(turnoutLine({ ...base, turnout: { ballotsCounted: 22906, registered: null } })).toBe('22,906 ballots counted');
  });
  it('Broomfield turnout reads "N ballots counted · M registered voters"', () => {
    expect(turnoutLine({ ...base, town: 'broomfield_co', turnout: { ballotsCounted: 37961, registered: 57682 } })).toBe('37,961 ballots counted · 57,682 registered voters');
  });
});

import { nextPollDelay } from './election-results';
describe('results page polling', () => {
  it('asks every 3 minutes while live, every minute before and after errors, and stops when updates have ended', () => {
    expect(nextPollDelay('night')).toBe(180_000);
    expect(nextPollDelay('after')).toBe(180_000);
    expect(nextPollDelay('before')).toBe(60_000);
    expect(nextPollDelay(null)).toBe(60_000);
    expect(nextPollDelay('done')).toBeNull();
  });
});

describe('progressRow / lastUpdatedLabel (Colorado precinct count is not shown)', () => {
  const bf = { available: true, town: 'broomfield_co', electionDate: '2026-11-03', phase: 'night', unofficial: true, sourceUpdatedAt: '11/3/2026 8:47:06 PM MST',
    precincts: { reported: 0, total: 59 }, turnout: { ballotsCounted: 37961, registered: 57682 } } as ResultsPayload;
  it('Broomfield: unofficial label, last-updated time and turnout, never the precinct count', () => {
    const row = progressRow(bf);
    expect(row).toBe('Unofficial results · Last updated 8:47 PM MT · 37,961 ballots counted · 57,682 registered voters');
    expect(row).not.toMatch(/precinct/i);
  });
  it('Brookings keeps its reporting count', () => {
    expect(progressRow({ ...bf, town: 'brookings_sd', precincts: { reported: 12, total: 40 } })).toContain('12 of 40 precincts reporting');
  });
  it('time labels', () => {
    expect(lastUpdatedLabel('11/3/2026 9:45 PM CT')).toBe('9:45 PM CT');
    expect(lastUpdatedLabel('11/3/2026 9:14:10 PM MDT')).toBe('9:14 PM MT');
    expect(lastUpdatedLabel(null)).toBeNull();
    expect(lastUpdatedLabel('yesterday')).toBe('yesterday');
  });
});
