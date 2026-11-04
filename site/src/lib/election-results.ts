/** Pure helpers for /election-results (spec: .claude/specs/election-2026.md, 2e). The page fetches the
 *  Worker's JSON in the browser and renders it with these; nothing here calls a model, sorts by votes
 *  or labels anyone a winner/leader (hard rule 2). */

export interface ResultsPayload {
  available: boolean;
  town: string;
  electionDate: string;
  phase: 'before' | 'night' | 'after' | 'done';
  unofficial: true;
  sourceUpdatedAt?: string | null;
  fetchedAt?: string;
  sourceUrl?: string;
  precincts?: { reported: number | null; total: number | null };
  turnout?: { ballotsCounted: number | null; registered: number | null };
  contests?: Array<{ id: string; name: string; choices: Array<{ name: string; votes: number; pct: number }> }>;
}

/** Colorado's state event (CO/<id>/) carries every contest in the state: all legislative seats, judges of other
 *  districts, other towns' ballot issues (302 on 2026-11-03). Broomfield's page promises "statewide and federal
 *  contests" (config/election.ts source_name), so those are the ones shown: U.S. Senate (20), U.S. House (110-180),
 *  statewide offices (210-240), appellate retention (3600-3660) and statewide amendments/propositions (6000-6130).
 *  Once Broomfield's own county event takes over (/CO/Broomfield/ in the source URL) every contest is local and nothing is dropped. */
export function contestsInScope(p: ResultsPayload): NonNullable<ResultsPayload['contests']> {
  const all = p.contests ?? [];
  if (p.town !== 'broomfield_co' || !p.sourceUrl || p.sourceUrl.includes('/CO/Broomfield/')) return all;
  const inRange = (n: number) => n === 20 || (n >= 110 && n <= 180) || (n >= 210 && n <= 240) || (n >= 3600 && n <= 3660) || (n >= 6000 && n <= 6130);
  return all.filter((c) => inRange(Number(c.id)));
}

export const RESULTS_ENDPOINT = '/api/election-results';

/** The town is never sent: the site Worker derives it from the request hostname (server/election-results.ts). */
export function endpointFor(): string {
  return RESULTS_ENDPOINT;
}

/** The single line above the results (spec 2e). */
export function metaLine(p: ResultsPayload, sourceName: string, timezone: string): string {
  const fetched = p.fetchedAt ? new Date(p.fetchedAt).toLocaleString('en-US', {
    timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }) : 'unknown';
  const updated = p.sourceUpdatedAt ? ` at ${p.sourceUpdatedAt}` : '';
  return `Unofficial results · Updated by ${sourceName}${updated} · Fetched at ${fetched}`;
}

export type ViewState =
  | { kind: 'results' }
  | { kind: 'waiting'; text: string }
  | { kind: 'unavailable'; text: string };

/** What the page shows. `payload` null = the endpoint could not be reached. */
export function viewState(payload: ResultsPayload | null): ViewState {
  if (!payload) return { kind: 'unavailable', text: 'Live results could not be loaded right now. Use the official source linked below.' };
  if (payload.available && payload.contests && payload.contests.length > 0) return { kind: 'results' };
  if (payload.phase === 'before') return { kind: 'waiting', text: 'Results will appear after polls close.' };
  if (payload.phase === 'done') return { kind: 'unavailable', text: 'Automatic updates have ended. See the official source linked below.' };
  return { kind: 'waiting', text: 'No validated results yet. Numbers appear here once the official source has published a complete count.' };
}

export function precinctsLine(p: ResultsPayload): string | null {
  const r = p.precincts;
  if (!r || r.reported == null || r.total == null) return null;
  return `${r.reported.toLocaleString('en-US')} of ${r.total.toLocaleString('en-US')} precincts reporting`;
}

export function turnoutLine(p: ResultsPayload): string | null {
  const t = p.turnout;
  if (!t || t.ballotsCounted == null) return null;
  const reg = t.registered != null && t.registered > 0 ? ` of ${t.registered.toLocaleString('en-US')} registered voters` : '';
  return `${t.ballotsCounted.toLocaleString('en-US')} ballots counted${reg}`;
}

/** Milliseconds until the results page asks again, or null to stop. 3 minutes while results are live
 *  (the Worker fetches every 10), 1 minute before they start (so the page notices) and after an error. */
export function nextPollDelay(phase: string | null): number | null {
  if (phase === 'night' || phase === 'after') return 180_000;
  if (phase === 'done') return null;
  return 60_000;
}
