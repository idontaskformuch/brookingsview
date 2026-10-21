/** One cron tick for one town: gate by phase -> read source -> hash -> validate -> store.
 *  Fail closed: a source error stores nothing; an invalid snapshot is stored with valid=false and
 *  never shown, so the last valid snapshot keeps being served with its own timestamp. */
import { shouldFetch } from './phase';
import type { SourceReading } from './sources';
import type { TownElection } from './towns';
import type { Snapshot } from './types';
import { validateSnapshot } from './validate';

export interface SaveRecord {
  reading: SourceReading;
  hash: string;
  valid: boolean;
  problems: string[];
}

export interface Store {
  lastValid(townId: string, electionDate: string): Promise<Snapshot | null>;
  hasHash(townId: string, electionDate: string, hash: string): Promise<boolean>;
  save(rec: SaveRecord): Promise<void>;
}

export interface Deps {
  now: () => Date;
  read: (town: TownElection, now: Date) => Promise<SourceReading | null>;
  store: Store;
}

export type TickOutcome =
  | { action: 'skipped'; reason: 'phase' | 'link-only' | 'no-source' }
  | { action: 'unchanged' }
  | { action: 'saved'; valid: boolean; problems: string[] }
  | { action: 'error'; message: string };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runTown(town: TownElection, deps: Deps): Promise<TickOutcome> {
  const now = deps.now();
  if (town.source.kind === 'link_only') return { action: 'skipped', reason: 'link-only' };
  if (!shouldFetch(now, town.cadence)) return { action: 'skipped', reason: 'phase' };
  try {
    const reading = await deps.read(town, now);
    if (!reading) return { action: 'skipped', reason: 'no-source' };
    const date = town.cadence.electionDate;
    const hash = await sha256Hex(reading.raw);
    if (await deps.store.hasHash(town.townId, date, hash)) return { action: 'unchanged' };

    const previous = await deps.store.lastValid(town.townId, date);
    const scope = previous ? previous.contests.map((c) => c.sourceContestId) : [];
    const result = validateSnapshot(reading.snapshot, previous, scope);
    await deps.store.save({ reading, hash, valid: result.valid, problems: result.problems });
    return { action: 'saved', valid: result.valid, problems: result.problems };
  } catch (e) {
    return { action: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
