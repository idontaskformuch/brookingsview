import { describe, expect, it } from 'vitest';
import { endpointFor, metaLine, precinctsLine, turnoutLine, viewState, type ResultsPayload } from './election-results';

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
  });
});
