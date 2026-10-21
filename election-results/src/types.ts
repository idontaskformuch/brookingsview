/** Source-neutral shapes shared by every county adapter (spec: .claude/specs/election-2026.md, 2b).
 *  Adapters only translate; validate.ts decides whether a snapshot may be shown. */

export interface Choice {
  /** Exactly as the source prints it after whitespace normalisation. */
  name: string;
  votes: number;
}

export interface Contest {
  /** The source's own contest id, never derived from the name (spec 2c: no fuzzy matching). */
  sourceContestId: string;
  name: string;
  /** Party code from the source where the contest is partisan (SD: REP/DEM), else null. */
  party: string | null;
  /** Choices in the order the source prints them (choice_order). */
  choices: Choice[];
}

export interface Snapshot {
  townId: string;
  electionDate: string;
  sourceUrl: string;
  /** The source's own "last updated" time as printed, or null when the source gives none. */
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  precinctsReported: number | null;
  precinctsTotal: number | null;
  contests: Contest[];
}

export interface ValidationResult {
  valid: boolean;
  /** Empty when valid. Every blocking reason is listed, not only the first. */
  problems: string[];
}
