import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseSdWorkbook, normalizeName } from '../src/adapters/sd-xlsx';
import { validateSnapshot, pctOf } from '../src/validate';
import { parseSourceTime, closesAt } from '../src/phase';
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
    expect(validateSnapshot(snap([c('1', ['A', 12], ['B', 5])]), prev, ['1'])).toEqual({ valid: true, problems: [], review: [] });
  });
  it('treats decreasing votes as a source reset: valid new baseline, flagged for review (owner 2026-10-28)', () => {
    const r = validateSnapshot(snap([c('1', ['A', 9], ['B', 5])]), prev, ['1']);
    expect(r).toMatchObject({ valid: true, problems: [] });
    expect(r.review.join()).toMatch(/source reset, new baseline.*decreased 10 -> 9/);
  });
  it('treats zeros after earlier results as a reset too, but zeros with nothing before stay blocked', () => {
    const zero = snap([c('1', ['A', 0], ['B', 0])]);
    expect(validateSnapshot(zero, prev, ['1'])).toMatchObject({ valid: true, review: [expect.stringMatching(/every vote count is 0/)] });
    expect(validateSnapshot(zero, null, ['1']).valid).toBe(false);
  });
  it('treats fewer precincts reported than before as a reset', () => {
    const r = validateSnapshot({ ...snap([c('1', ['A', 11], ['B', 5])]), precinctsReported: 400 }, prev, ['1']);
    expect(r.valid).toBe(true);
    expect(r.review.join()).toMatch(/precincts reported decreased 686 -> 400/);
  });
  it('still blocks a changed candidate set even when the source also looks reset', () => {
    expect(validateSnapshot(snap([c('1', ['A', 1], ['Z', 0])]), prev, ['1']).valid).toBe(false);
  });
  describe('polls-closed gate', () => {
    const closes = new Date('2026-11-04T01:00:00Z'); // 19:00 CST
    const poll = { closesAt: closes, timezone: 'America/Chicago' };
    const live = (over: Partial<Snapshot>) => ({ ...snap([c('1', ['A', 3], ['B', 1])]), ...over });
    it('rejects a snapshot fetched before the polls closed', () => {
      expect(validateSnapshot(live({ fetchedAt: '2026-11-04T00:59:00Z' }), null, ['1'], poll).valid).toBe(false);
    });
    it('rejects source_updated_at before close (SD test data), with all precincts reported called out', () => {
      const r = validateSnapshot(live({ fetchedAt: '2026-11-04T01:10:00Z', sourceUpdatedAt: '10/28/2026 2:39 PM CT', precinctsReported: 671, precinctsTotal: 671 }), null, ['1'], poll);
      expect(r.valid).toBe(false);
      expect(r.problems.join()).toMatch(/before the polls closed.*all precincts already reported/);
    });
    it('accepts data stamped after close, and a time-only stamp it cannot place', () => {
      expect(validateSnapshot(live({ fetchedAt: '2026-11-04T01:10:00Z', sourceUpdatedAt: '11/3/2026 7:08 PM CT' }), null, ['1'], poll).valid).toBe(true);
      expect(validateSnapshot(live({ fetchedAt: '2026-11-04T01:10:00Z', sourceUpdatedAt: '7:08 PM CT' }), null, ['1'], poll).valid).toBe(true);
    });
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

describe('parseSdWorkbook, general-election sheet names (no party prefix)', () => {
  /** The November 2026 workbook names sheets "<contestId><name>" ("14412United States Senator"), not
   *  "<PARTY><contestId>...": derived here from the June fixture by dropping the 3-letter prefix. */
  const general = (() => {
    const files = unzipSync(bytes);
    files['xl/workbook.xml'] = strToU8(strFromU8(files['xl/workbook.xml']).replace(/(<(?:\w+:)?sheet [^>]*name=")[A-Z]{3}(\d+)/g, '$1$2'));
    return new Uint8Array(zipSync(files));
  })();

  it('reads every contest with party null and the same ids and totals', () => {
    const a = parseSdWorkbook(bytes);
    const b = parseSdWorkbook(general);
    expect(b.contests.map((c) => c.sourceContestId)).toEqual(a.contests.map((c) => c.sourceContestId));
    expect(b.contests.every((c) => c.party === null)).toBe(true);
    expect(b.contests.map((c) => c.choices)).toEqual(a.contests.map((c) => c.choices));
  });

  it('still rejects a sheet with no contest id at all', () => {
    const files = unzipSync(bytes);
    files['xl/workbook.xml'] = strToU8(strFromU8(files['xl/workbook.xml']).replace(/name="[A-Z]{3}\d+/, 'name="Summary'));
    expect(() => parseSdWorkbook(new Uint8Array(zipSync(files)))).toThrow(/contest id/);
  });
});

describe('source time helpers', () => {
  it('reads dated stamps in the town zone and ignores undated ones', () => {
    expect(parseSourceTime('10/28/2026 2:39 PM CT', 'America/Chicago')?.toISOString()).toBe('2026-10-28T19:39:00.000Z');
    expect(parseSourceTime('7/23/2026 4:21:16 PM MDT', 'America/Denver')?.toISOString()).toBe('2026-07-23T22:21:00.000Z');
    expect(parseSourceTime('12:05 AM', 'America/Chicago')).toBeNull();
    expect(parseSourceTime(null, 'America/Chicago')).toBeNull();
  });
  it('polls close 19:00 local in CT/MT (and 20:00 PT) across the November standard-time switch', () => {
    const base = { electionDate: '2026-11-03', fetchUntil: '2026-11-30' };
    expect(closesAt({ ...base, timezone: 'America/Chicago', startLocal: '19:00' }).toISOString()).toBe('2026-11-04T01:00:00.000Z');
    expect(closesAt({ ...base, timezone: 'America/Denver', startLocal: '19:00' }).toISOString()).toBe('2026-11-04T02:00:00.000Z');
    expect(closesAt({ ...base, timezone: 'America/Los_Angeles', startLocal: '20:00' }).toISOString()).toBe('2026-11-04T04:00:00.000Z');
  });
});
