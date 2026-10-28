/** Spec 2c: a snapshot is `valid` only if every check passes. A failing snapshot is still stored
 *  (raw data is never dropped) but never shown; the last valid one stays with its own timestamp. */
import { parseSourceTime } from './phase';
import type { Snapshot, ValidationResult } from './types';

export function pctOf(votes: number, total: number): number {
  return total === 0 ? 0 : Math.round((votes / total) * 1000) / 10;
}

export function validateSnapshot(
  next: Snapshot,
  previousValid: Snapshot | null,
  /** races_in_scope: the source contest ids this town must show. */
  scope: readonly string[],
  /** Polls close: nothing is accepted from before it (the sources serve test data until then). */
  poll?: { closesAt: Date; timezone: string },
): ValidationResult {
  const problems: string[] = [];
  const review: string[] = [];

  if (poll) {
    const fetched = new Date(next.fetchedAt);
    const updated = parseSourceTime(next.sourceUpdatedAt, poll.timezone);
    const allIn = next.precinctsTotal != null && next.precinctsTotal > 0 && next.precinctsReported === next.precinctsTotal;
    if (fetched < poll.closesAt) problems.push('fetched before the polls closed (test data)');
    if (updated && updated < poll.closesAt) {
      problems.push(`source_updated_at "${next.sourceUpdatedAt}" is before the polls closed (test data)${allIn ? '; all precincts already reported' : ''}`);
    }
  }

  if (next.contests.length === 0) problems.push('empty response: no contests');

  // Hard rule 5: zeroed data is never published (polls closed but nothing counted yet) -- unless a
  // valid snapshot exists, in which case zeros mean the source was reset (handled below as a new baseline).
  const allZero = next.contests.length > 0 && next.contests.every((c) => c.choices.every((ch) => ch.votes === 0));
  if (allZero && !previousValid) problems.push('zeroed response: every vote count is 0');

  const byId = new Map(next.contests.map((c) => [c.sourceContestId, c]));
  for (const id of scope) {
    if (!byId.has(id)) problems.push(`contest ${id} in scope is missing from the response`);
  }

  for (const c of next.contests) {
    for (const ch of c.choices) {
      if (!Number.isInteger(ch.votes) || ch.votes < 0) {
        problems.push(`contest ${c.sourceContestId} "${ch.name}": votes ${ch.votes} is not an integer >= 0`);
      }
    }
  }

  const decreases: string[] = [];
  if (previousValid) {
    const prev = new Map(previousValid.contests.map((c) => [c.sourceContestId, c]));
    for (const id of scope) {
      const before = prev.get(id);
      const now = byId.get(id);
      if (!before || !now) continue;
      const beforeNames = before.choices.map((c) => c.name).sort();
      const nowNames = now.choices.map((c) => c.name).sort();
      if (beforeNames.join('\u0000') !== nowNames.join('\u0000')) {
        problems.push(`contest ${id}: candidate set changed (${beforeNames.join(', ')} -> ${nowNames.join(', ')})`);
        continue;
      }
      const prevVotes = new Map(before.choices.map((c) => [c.name, c.votes]));
      for (const ch of now.choices) {
        const was = prevVotes.get(ch.name)!;
        if (ch.votes < was) decreases.push(`contest ${id} "${ch.name}": votes decreased ${was} -> ${ch.votes}`);
      }
    }
    if (previousValid.precinctsReported != null && next.precinctsReported != null && next.precinctsReported < previousValid.precinctsReported) {
      decreases.push(`precincts reported decreased ${previousValid.precinctsReported} -> ${next.precinctsReported}`);
    }
    if (allZero) decreases.push('every vote count is 0 after earlier results');
    // Owner decision 2026-10-28: falling counts / zeros mean the source was reset. Accept as the new
    // baseline (the snapshot becomes the "last valid" the next one is compared with), never block, flag it.
    if (decreases.length > 0) review.push(`source reset, new baseline: ${decreases.slice(0, 5).join('; ')}${decreases.length > 5 ? ` (+${decreases.length - 5} more)` : ''}`);
  }

  return { valid: problems.length === 0, problems, review };
}
