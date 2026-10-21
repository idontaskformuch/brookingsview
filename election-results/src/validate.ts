/** Spec 2c: a snapshot is `valid` only if every check passes. A failing snapshot is still stored
 *  (raw data is never dropped) but never shown; the last valid one stays with its own timestamp. */
import type { Snapshot, ValidationResult } from './types';

export function pctOf(votes: number, total: number): number {
  return total === 0 ? 0 : Math.round((votes / total) * 1000) / 10;
}

export function validateSnapshot(
  next: Snapshot,
  previousValid: Snapshot | null,
  /** races_in_scope: the source contest ids this town must show. */
  scope: readonly string[],
): ValidationResult {
  const problems: string[] = [];

  if (next.contests.length === 0) problems.push('empty response: no contests');

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
        if (ch.votes < was) problems.push(`contest ${id} "${ch.name}": votes decreased ${was} -> ${ch.votes}`);
      }
    }
  }

  return { valid: problems.length === 0, problems };
}
