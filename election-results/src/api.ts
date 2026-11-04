/** The public JSON the /election-results page renders. Deterministic: numbers come from the stored
 *  snapshot, percentages are recomputed from votes, choices keep the source's order (no sorting by
 *  votes, no "leading"/"winner" field -- hard rule 2). */
import { phaseAt, type Phase } from './phase';
import type { TownElection } from './towns';
import type { Snapshot } from './types';
import { pctOf } from './validate';

export interface PublicResults {
  available: boolean;
  town: string;
  electionDate: string;
  phase: Phase;
  /** Always true while we publish anything: spec hard rule 4. */
  unofficial: true;
  sourceUpdatedAt?: string | null;
  fetchedAt?: string;
  sourceUrl?: string;
  precincts?: { reported: number | null; total: number | null };
  turnout?: { ballotsCounted: number | null; registered: number | null };
  contests?: Array<{
    id: string;
    name: string;
    choices: Array<{ name: string; votes: number; pct: number }>;
  }>;
}

/** Colorado's state event (CO/<id>/) carries every contest in the state: all legislative seats, judges of other
 *  districts, other towns' ballot issues (302 on 2026-11-03). Broomfield's page promises "statewide and federal
 *  contests" (config/election.ts source_name), so those are the ones published: U.S. Senate (20), U.S. House (110-180),
 *  statewide offices (210-240), appellate retention (3600-3660) and statewide amendments/propositions (6000-6130).
 *  Once Broomfield's own county event takes over (/CO/Broomfield/ in the source URL) every contest is local and nothing is dropped.
 *  Moved here from the browser (site/src/lib/election-results.ts) so /api/election-results never carries the rest. */
export function contestsInScope<T extends { id: string }>(townId: string, sourceUrl: string | undefined, contests: T[]): T[] {
  if (townId !== 'broomfield_co' || !sourceUrl || sourceUrl.includes('/CO/Broomfield/')) return contests;
  const inRange = (n: number) => n === 20 || (n >= 110 && n <= 180) || (n >= 210 && n <= 240) || (n >= 3600 && n <= 3660) || (n >= 6000 && n <= 6130);
  return contests.filter((c) => inRange(Number(c.id)));
}

export function toPublic(town: TownElection, snapshot: Snapshot | null, now: Date): PublicResults {
  const base = { town: town.townId, electionDate: town.cadence.electionDate, phase: phaseAt(now, town.cadence), unofficial: true as const };
  if (!snapshot) return { available: false, ...base };
  return {
    available: true,
    ...base,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    fetchedAt: snapshot.fetchedAt,
    sourceUrl: snapshot.sourceUrl,
    precincts: { reported: snapshot.precinctsReported, total: snapshot.precinctsTotal },
    turnout: snapshot.turnout ? { ballotsCounted: snapshot.turnout.ballotsCounted, registered: snapshot.turnout.registered } : undefined,
    contests: contestsInScope(town.townId, snapshot.sourceUrl, snapshot.contests.map((c) => {
      const total = c.choices.reduce((a, ch) => a + ch.votes, 0);
      return { id: c.sourceContestId, name: c.name, choices: c.choices.map((ch) => ({ name: ch.name, votes: ch.votes, pct: pctOf(ch.votes, total) })) };
    })),
  };
}
