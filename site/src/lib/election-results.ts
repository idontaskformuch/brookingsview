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

export interface StaticView {
  /** The status line in the server-rendered HTML. */
  text: string;
  /** The browser keeps asking /api/election-results: only while the build is from before the end of election night. */
  poll: boolean;
  /** The build's own numbers are rendered in the HTML. */
  showNumbers: boolean;
}

/** What the server-rendered page says (owner B4, 2026-11-11): from the morning after Election Day the page is the
 *  build's numbers, frozen, and never says "live" or that counting continues; the daily build picks up a newer
 *  snapshot until the Worker stops fetching (fetchUntil). `p` null = a link-only town. */
export function staticView(p: ResultsPayload | null, sourceName: string, siteName: string): StaticView {
  if (!p) return { text: `${siteName} does not copy these numbers. The official results are published by ${sourceName}.`, poll: false, showNumbers: false };
  const hasNumbers = viewState(p).kind === 'results';
  if (p.phase === 'before' || p.phase === 'night') {
    return {
      text: `Live results load in your browser from ${sourceName} and change as counting continues. If nothing appears here, the official numbers are linked under Official source below.`,
      poll: true, showNumbers: hasNumbers,
    };
  }
  if (!hasNumbers) return { text: `No validated results were published here. The official results are linked under Official source below.`, poll: false, showNumbers: false };
  return {
    text: 'These are the unofficial numbers from the latest update we read. The final numbers are the ones the election authority certifies; the official source below has them.',
    poll: false, showNumbers: true,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The one line above the frozen numbers: when the source last updated them (its own stamp, "Nov 10, 5:52 PM MT"; the
 *  time we read them when the source gives none), then the count rows. The hero already says "Unofficial results". */
export function staticMetaLine(p: ResultsPayload, timezone: string): string {
  const day = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(p.sourceUpdatedAt ?? '');
  const clock = lastUpdatedLabel(p.sourceUpdatedAt);
  const when = day
    ? `Last updated by the source ${MONTHS[Number(day[1]) - 1]} ${Number(day[2])}${clock && clock !== p.sourceUpdatedAt ? `, ${clock}` : ''}`
    : p.fetchedAt
      ? `Numbers as read ${new Date(p.fetchedAt).toLocaleString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`
      : null;
  const counts = p.town === 'broomfield_co' ? [turnoutLine(p)] : [precinctsLine(p), turnoutLine(p)];
  return [when, ...counts].filter(Boolean).join(' · ');
}

export function precinctsLine(p: ResultsPayload): string | null {
  const r = p.precincts;
  if (!r || r.reported == null || r.total == null) return null;
  return `${r.reported.toLocaleString('en-US')} of ${r.total.toLocaleString('en-US')} precincts reporting`;
}

export function turnoutLine(p: ResultsPayload): string | null {
  const t = p.turnout;
  if (!t || t.ballotsCounted == null) return null;
  const registered = t.registered != null && t.registered > 0 ? t.registered.toLocaleString('en-US') : null;
  const counted = `${t.ballotsCounted.toLocaleString('en-US')} ballots counted`;
  if (!registered) return counted;
  // Broomfield's row reads as two facts ("N ballots counted · M registered voters"); "of" implied a share of the electorate the state feed cannot back up.
  return p.town === 'broomfield_co' ? `${counted} · ${registered} registered voters` : `${counted} of ${registered} registered voters`;
}

/** "8:47 PM MT" from a source stamp like "11/3/2026 8:47:06 PM MST" (seconds dropped, MST/MDT -> MT); the raw stamp when it has no clock time. */
export function lastUpdatedLabel(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const m = /(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)\s*([A-Z]{2,4})?/i.exec(stamp);
  if (!m) return stamp;
  const tz = m[3] ? ` ${m[3].toUpperCase().replace(/^([CMPE])[SD]T$/, '$1T')}` : '';
  return `${m[1]} ${m[2].toUpperCase()}${tz}`;
}

/** The progress row under the meta line. Colorado's state feed does not fill its precinct counts as mail ballots are
 *  counted ("0 of 59" beside real vote totals looks broken), so Broomfield shows the unofficial label, the source's
 *  last-updated time and turnout instead; Brookings keeps its reporting count. */
export function progressRow(p: ResultsPayload): string {
  if (p.town === 'broomfield_co') {
    const updated = lastUpdatedLabel(p.sourceUpdatedAt);
    return ['Unofficial results', updated ? `Last updated ${updated}` : null, turnoutLine(p)].filter(Boolean).join(' · ');
  }
  return [precinctsLine(p), turnoutLine(p)].filter(Boolean).join(' · ');
}

/** Milliseconds until the results page asks again, or null to stop. 3 minutes while results are live
 *  (the Worker fetches every 10), 1 minute before they start (so the page notices) and after an error. */
export function nextPollDelay(phase: string | null): number | null {
  if (phase === 'night' || phase === 'after') return 180_000;
  if (phase === 'done') return null;
  return 60_000;
}
