import { describe, expect, it } from 'vitest';
import { handleElectionResults } from './election-results';
import type { Env } from './_shared';
import type { Snapshot } from '../../election-results/src/types';

const env = { DATABASE_URL: 'postgres://unused' } as Env;
const req = (host: string, qs = '') => new Request(`https://${host}/api/election-results${qs}`);
const snap = (townId: string): Snapshot => ({
  townId, electionDate: '2026-11-03', sourceUrl: 'https://example.test/', sourceUpdatedAt: '9:05 PM CT', fetchedAt: '2026-11-04T03:07:00Z',
  precinctsReported: 1, precinctsTotal: 2,
  contests: [{ sourceContestId: '1', name: 'Sheriff', party: null, choices: [{ name: 'A', votes: 3 }, { name: 'B', votes: 1 }] }],
});
const now = () => new Date('2026-11-04T03:10:00Z');

describe('GET /api/election-results', () => {
  it('derives the town from the hostname and ignores any ?town= parameter', async () => {
    const seen: string[] = [];
    const loadLatestValid = async (_u: string, townId: string) => { seen.push(townId); return snap(townId); };
    const r = await handleElectionResults(req('brookingsview.com', '?town=broomfield_co'), env, { now, loadLatestValid });
    const j = await r.json() as { town: string; contests: Array<{ choices: Array<{ pct: number }> }>; unofficial: boolean };
    expect(seen).toEqual(['brookings_sd']);
    expect(j.town).toBe('brookings_sd');
    expect(j.unofficial).toBe(true);
    expect(j.contests[0].choices.map((c) => c.pct)).toEqual([75, 25]);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=30');
  });
  it('answers available:false when nothing valid exists yet', async () => {
    const r = await handleElectionResults(req('www.broomfieldview.com'), env, { now, loadLatestValid: async () => null });
    expect(await r.json()).toMatchObject({ available: false, town: 'broomfield_co', unofficial: true });
  });
  it('never reads the database for the link-only town', async () => {
    const r = await handleElectionResults(req('morenovalleyview.com'), env, { now, loadLatestValid: async () => { throw new Error('must not be called'); } });
    expect(await r.json()).toMatchObject({ available: false, town: 'moreno_valley_ca' });
  });
  it('404s for an unknown host', async () => {
    expect((await handleElectionResults(req('example.org'), env, { now })).status).toBe(404);
  });
});
