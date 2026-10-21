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
    contests: snapshot.contests.map((c) => {
      const total = c.choices.reduce((a, ch) => a + ch.votes, 0);
      return { id: c.sourceContestId, name: c.name, choices: c.choices.map((ch) => ({ name: ch.name, votes: ch.votes, pct: pctOf(ch.votes, total) })) };
    }),
  };
}
