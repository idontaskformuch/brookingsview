/** Per-town fetch configuration. Nothing here is keyed on a town NAME elsewhere in the package:
 *  adapters are chosen by `source`, so a fourth town is a new entry, not new branches. */
import type { Cadence } from './phase';

export type TownSource =
  | { kind: 'sd_xlsx'; county: string }
  | { kind: 'clarity_co'; county: string }
  /** No automatic fetch: the page links to the official results (Riverside ROV, pending permission). */
  | { kind: 'link_only' };

export interface TownElection {
  townId: string;
  source: TownSource;
  cadence: Cadence;
}

const ELECTION_DATE = '2026-11-03';
/** ASSUMPTION (not source-verified): certification of the 2026 general falls before this date in both
 *  states; fetching after it is simply stopped. Owner to confirm/adjust. */
const FETCH_UNTIL = '2026-11-30';

export const TOWNS: Record<string, TownElection> = {
  brookings_sd: {
    townId: 'brookings_sd',
    source: { kind: 'sd_xlsx', county: 'Brookings' },
    // Spec says 20:00 local; SD and CO polls close at 7 p.m. local (Broomfield's own page: Election Day
    // 7:00 a.m.-7:00 p.m.), so starting at 20:00 would miss the first hour of results. Empty/zeroed
    // snapshots are rejected anyway, so starting at 19:00 is harmless.
    cadence: { electionDate: ELECTION_DATE, timezone: 'America/Chicago', startLocal: '19:00', fetchUntil: FETCH_UNTIL },
  },
  broomfield_co: {
    townId: 'broomfield_co',
    source: { kind: 'clarity_co', county: 'Broomfield' },
    cadence: { electionDate: ELECTION_DATE, timezone: 'America/Denver', startLocal: '19:00', fetchUntil: FETCH_UNTIL },
  },
  moreno_valley_ca: {
    townId: 'moreno_valley_ca',
    source: { kind: 'link_only' },
    cadence: { electionDate: ELECTION_DATE, timezone: 'America/Los_Angeles', startLocal: '20:00', fetchUntil: FETCH_UNTIL },
  },
};
