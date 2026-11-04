import { describe, expect, it } from 'vitest';
import { contestsInScope, toPublic } from '../src/api';
import type { TownElection } from '../src/towns';
import type { Snapshot } from '../src/types';

const mk = (id: string, name: string) => ({ id, name, choices: [] as never[] });
const contests = [mk('20', 'United States Senator'), mk('150', 'Representative - District 5'), mk('210', 'Governor'), mk('3600', 'Supreme Court Justice - Hood'),
  mk('6000', 'Amendment 81'), mk('6130', 'Proposition 137'), mk('1010', 'State Senator - District 1'), mk('2001', 'State Representative - District 1'),
  mk('4020', 'District Court Judge - 2nd'), mk('5120', 'County Court Judge - Denver'), mk('7306', 'City of Aurora Ballot Issue 3A'), mk('7702', '17th Judicial District Ballot Question 7E')];
const STATE = 'https://results.enr.clarityelections.com/CO/127407/384556/';

describe('contestsInScope (Broomfield publishes statewide and federal contests only)', () => {
  it('drops legislative seats, judges of other districts and other towns ballot issues from the state event', () => {
    expect(contestsInScope('broomfield_co', STATE, contests).map((c) => c.id)).toEqual(['20', '150', '210', '3600', '6000', '6130']);
  });
  it('keeps everything once the Broomfield county event is the source, and for other towns', () => {
    expect(contestsInScope('broomfield_co', 'https://results.enr.clarityelections.com/CO/Broomfield/130000/1/', contests)).toHaveLength(contests.length);
    expect(contestsInScope('brookings_sd', STATE, contests)).toHaveLength(contests.length);
  });
  it('keeps everything when the source URL is unknown rather than guessing', () => {
    expect(contestsInScope('broomfield_co', undefined, contests)).toHaveLength(contests.length);
  });
});

describe('toPublic applies the scope on the Worker side', () => {
  const town: TownElection = { townId: 'broomfield_co', source: { kind: 'clarity_co', county: 'Broomfield' },
    cadence: { electionDate: '2026-11-03', timezone: 'America/Denver', startLocal: '19:00', fetchUntil: '2026-11-10' } };
  const snap = {
    townId: 'broomfield_co', electionDate: '2026-11-03', sourceUrl: STATE, sourceUpdatedAt: null, fetchedAt: '2026-11-04T04:00:00Z',
    precinctsReported: null, precinctsTotal: null, turnout: { ballotsCounted: 10, registered: 20 },
    contests: contests.map((c) => ({ sourceContestId: c.id, name: c.name, choices: [{ name: 'A', votes: 3 }, { name: 'B', votes: 1 }] })),
  } as unknown as Snapshot;
  it('the API response holds only the in-scope contests, with unchanged numbers', () => {
    const out = toPublic(town, snap, new Date('2026-11-04T05:00:00Z'));
    expect(out.contests?.map((c) => c.id)).toEqual(['20', '150', '210', '3600', '6000', '6130']);
    expect(out.contests?.[0].choices).toEqual([{ name: 'A', votes: 3, pct: 75 }, { name: 'B', votes: 1, pct: 25 }]);
    expect(out.turnout).toEqual({ ballotsCounted: 10, registered: 20 });
  });
});
