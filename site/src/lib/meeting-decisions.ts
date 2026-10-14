/** Phase 7, "Decisions" -- pure display logic for meeting_decisions rows,
 *  kept out of s/[slug].astro so it's unit-testable (same pattern as
 *  lib/event-jsonld.ts). See ai_pipeline/meeting_decisions_legistar.py's
 *  module docstring for how these rows are built and verified.
 */

export interface MeetingVote {
  person: string;
  value: string;
}

export interface MeetingDecision {
  id: number;
  event_item_id: number;
  agenda_number: string | null;
  title: string;
  matter_id: number | null;
  matter_file: string | null;
  matter_type: string | null;
  action_text: string | null;
  outcome: 'approved' | 'denied' | 'continued' | 'adopted' | 'received_and_filed'
    | 'tabled' | 'other' | 'pending';
  is_consent_item: boolean;
  consent_block_event_item_id: number | null;
  votes: MeetingVote[] | null;
  source_url: string | null;
}

/** Display labels for the outcome enum -- never shown for 'pending' (that's
 *  the "On the agenda" bucket, not a decided one). */
export const OUTCOME_LABELS: Record<Exclude<MeetingDecision['outcome'], 'pending'>, string> = {
  approved: 'Approved',
  denied: 'Denied',
  continued: 'Continued',
  adopted: 'Adopted',
  received_and_filed: 'Received and filed',
  tabled: 'Tabled',
  other: 'No vote recorded',
};

/** Per ärende: a decision with no official result yet is "On the agenda";
 *  anything else is "Decided". Order preserved from the input (callers pass
 *  decisions already ordered by agenda position). */
export function partitionDecisions(decisions: MeetingDecision[]): {
  onAgenda: MeetingDecision[]; decided: MeetingDecision[];
} {
  const onAgenda = decisions.filter((d) => d.outcome === 'pending');
  const decided = decisions.filter((d) => d.outcome !== 'pending');
  return { onAgenda, decided };
}

const VOTE_BUCKETS = ['Yes', 'No', 'Absent', 'Abstain'] as const;
type VoteBucket = typeof VOTE_BUCKETS[number] | 'Other';

function voteBucket(value: string): VoteBucket {
  const match = VOTE_BUCKETS.find((b) => b.toLowerCase() === value.trim().toLowerCase());
  return match ?? 'Other';
}

/** "6-0" style tally (Yes-No), the headline number readers actually want.
 *  Null when there's no real per-member roll call to tally (e.g. a voice
 *  vote or an item with no vote at all) -- never fabricated as "0-0". */
export function voteTallyText(votes: MeetingVote[] | null): string | null {
  if (!votes || votes.length === 0) return null;
  const yes = votes.filter((v) => voteBucket(v.value) === 'Yes').length;
  const no = votes.filter((v) => voteBucket(v.value) === 'No').length;
  const extras: string[] = [];
  const absent = votes.filter((v) => voteBucket(v.value) === 'Absent').length;
  const abstain = votes.filter((v) => voteBucket(v.value) === 'Abstain').length;
  if (absent) extras.push(`${absent} absent`);
  if (abstain) extras.push(`${abstain} abstaining`);
  return extras.length ? `${yes}-${no} (${extras.join(', ')})` : `${yes}-${no}`;
}

/** What the vote was actually ABOUT -- always shown alongside the roll call
 *  per the owner's design decision, never a bare tally with no motion
 *  named. Falls back to the decision's own title when there's no distinct
 *  motion narrative (action_text). */
export function motionLabel(decision: MeetingDecision): string {
  return decision.action_text || decision.title;
}

/** The owner's explicit design decision: a consent-agenda item's block vote
 *  is labeled, never presented as if the item got its own separate roll
 *  call. */
export function consentNote(decision: MeetingDecision): string | null {
  return decision.is_consent_item ? 'Approved as part of the Consent Agenda' : null;
}

export function outcomeLabel(decision: MeetingDecision): string | null {
  if (decision.outcome === 'pending') return null;
  return OUTCOME_LABELS[decision.outcome];
}
