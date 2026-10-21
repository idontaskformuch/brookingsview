import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSdWorkbook, normalizeName } from '../src/adapters/sd-xlsx';
import { validateSnapshot, pctOf } from '../src/validate';
import type { Contest, Snapshot } from '../src/types';

const bytes = new Uint8Array(readFileSync(new URL('./fixtures/sd-brookings-2026-06-primary.xlsx', import.meta.url)));

function snap(contests: Contest[]): Snapshot {
  return {
    townId: 'brookings_sd', electionDate: '2026-06-02', sourceUrl: 'https://electionresults.sd.gov/', sourceUpdatedAt: null,
    fetchedAt: '2026-06-03T00:00:00Z', precinctsReported: 686, precinctsTotal: 686, contests,
  };
}

describe('parseSdWorkbook (finished June 2026 primary, Brookings County)', () => {
  const wb = parseSdWorkbook(bytes);
  const byId = new Map(wb.contests.map((c) => [c.sourceContestId, c]));

  it('reads header facts', () => {
    expect(wb.county).toBe('Brookings County');
    expect(wb.title).toMatch(/Unofficial Primary Election Results/);
    expect(wb.precinctsReported).toBe(686);
    expect(wb.precinctsTotal).toBe(686);
    expect(wb.downloadedAt).toMatch(/\d+\/\d+\/\d{4}/);
  });

  it('finds all 11 contests keyed by the numeric id in the sheet name', () => {
    expect(wb.contests).toHaveLength(11);
    expect([...byId.keys()]).toContain('13297');
  });

  it('reads the TOTALS row for the sheriff race', () => {
    const sheriff = byId.get('13297')!;
    expect(sheriff.party).toBe('REP');
    expect(sheriff.name).toBe('Sheriff - Brookings');
    expect(sheriff.choices).toEqual([
      { name: 'David Biteler', votes: 2506 },
      { name: 'Shawn Hostler', votes: 1141 },
    ]);
  });

  it('collapses the double spaces in candidate names and keeps column order', () => {
    const senate = byId.get('14082')!;
    expect(senate.choices.map((c) => c.name)).toEqual(['Justin McNeal', 'Mike Rounds']);
    expect(normalizeName('Mike  Rounds ')).toBe('Mike Rounds');
  });

  it('marks nonpartisan contests with party null', () => {
    expect(byId.get('13932')!.party).toBeNull();
  });

  it('rejects a workbook with no TOTALS row', () => {
    expect(() => parseSdWorkbook(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('validateSnapshot (spec 2c)', () => {
  const c = (id: string, ...votes: Array<[string, number]>): Contest => ({
    sourceContestId: id, name: id, party: null, choices: votes.map(([name, v]) => ({ name, votes: v })),
  });
  const prev = snap([c('1', ['A', 10], ['B', 5])]);

  it('accepts a snapshot where votes only grow', () => {
    expect(validateSnapshot(snap([c('1', ['A', 12], ['B', 5])]), prev, ['1'])).toEqual({ valid: true, problems: [] });
  });
  it('blocks decreasing votes', () => {
    const r = validateSnapshot(snap([c('1', ['A', 9], ['B', 5])]), prev, ['1']);
    expect(r.valid).toBe(false);
    expect(r.problems[0]).toMatch(/decreased 10 -> 9/);
  });
  it('blocks a missing in-scope contest', () => {
    const r = validateSnapshot(snap([c('2', ['A', 1])]), prev, ['1']);
    expect(r.valid).toBe(false);
    expect(r.problems.join()).toMatch(/contest 1 in scope is missing/);
  });
  it('blocks a changed candidate set', () => {
    const r = validateSnapshot(snap([c('1', ['A', 10], ['C', 5])]), prev, ['1']);
    expect(r.valid).toBe(false);
    expect(r.problems.join()).toMatch(/candidate set changed/);
  });
  it('blocks an empty response', () => {
    const r = validateSnapshot(snap([]), prev, ['1']);
    expect(r.valid).toBe(false);
    expect(r.problems.join()).toMatch(/empty response/);
  });
  it('blocks negative or non-integer votes', () => {
    expect(validateSnapshot(snap([c('1', ['A', -1])]), null, ['1']).valid).toBe(false);
    expect(validateSnapshot(snap([c('1', ['A', 1.5])]), null, ['1']).valid).toBe(false);
  });
  it('accepts the first snapshot with no predecessor', () => {
    expect(validateSnapshot(snap([c('1', ['A', 1])]), null, ['1']).valid).toBe(true);
  });
  it('computes percentages from votes, 0 for an empty contest', () => {
    expect(pctOf(2506, 2506 + 1141)).toBe(68.7);
    expect(pctOf(0, 0)).toBe(0);
  });
});

describe('zeroed data (hard rule 5)', () => {
  it('blocks a snapshot where every vote is 0', () => {
    const r = validateSnapshot(snap([{ sourceContestId: '1', name: 'x', party: null, choices: [{ name: 'A', votes: 0 }, { name: 'B', votes: 0 }] }]), null, ['1']);
    expect(r.valid).toBe(false);
    expect(r.problems.join()).toMatch(/zeroed/);
  });
});
