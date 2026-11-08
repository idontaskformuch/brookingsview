/** /jackrabbits as data: sport_events rows -> one group per team, each with its record, results (newest first) and schedule (soonest
 *  first). Every state decision is made by lib/sport-events.ts; this file only arranges. Pure, so it is testable without a database. */
import { isOpen, recordFor, resultLine, rowNote, sportPhase, type RowNote, type SportEventRow, type SportPhase } from './sport-events';

export type { RowNote };

export interface GameRow {
  id: number;
  sport: string;
  tz: string;
  status: SportEventRow['status'];
  startAt: Date;
  timeTba: boolean;
  prefix: 'vs' | 'at';
  opponent: string;
  venue: string | null;
  neutralSite: boolean;
  exhibition: boolean;
  phase: SportPhase;
  /** "W 91-62" for a final game, else null. */
  result: string | null;
  /** The word shown instead of a result when there is none. */
  note: RowNote;
}

export interface TeamGroup {
  /** Key the season summaries are filed under (slug jackrabbits-season-summary-<key>). */
  key: string;
  label: string;
  record: { wins: number; losses: number; ties: number } | null;
  hasExhibition: boolean;
  results: GameRow[];
  schedule: GameRow[];
}

const ORDER = ['football', 'mbb', 'wbb', 'volleyball'];

export function teamKey(ev: Pick<SportEventRow, 'sport' | 'gender'>): string {
  if (ev.sport === 'basketball') return ev.gender === 'women' ? 'wbb' : 'mbb';
  return ev.sport;
}

export function teamLabel(key: string): string {
  return key === 'mbb' ? "Men's basketball" : key === 'wbb' ? "Women's basketball" : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

export function toRow(ev: SportEventRow, programId: string, now: Date): GameRow {
  const phase = sportPhase(ev, now);
  const away = ev.awayProgramId === programId;
  const opponent = (away ? ev.homeName : ev.awayName) ?? '';
  const result = resultLine(ev, programId);
  const note = rowNote(ev.status, phase, result !== null);
  return {
    id: ev.id, sport: ev.sport, tz: ev.tz, status: ev.status, startAt: ev.startAt, timeTba: ev.timeTba, prefix: away && !ev.neutralSite ? 'at' : 'vs', opponent, venue: ev.venue,
    neutralSite: ev.neutralSite, exhibition: ev.exhibition, phase, result, note,
  };
}

export function buildGroups(events: SportEventRow[], programId: string, now: Date): TeamGroup[] {
  const byKey = new Map<string, SportEventRow[]>();
  for (const ev of events) {
    const k = teamKey(ev);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(ev);
  }
  const keys = [...byKey.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return keys.map((key) => {
    const evs = byKey.get(key)!.slice().sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id - b.id);
    const rows = evs.map((ev) => toRow(ev, programId, now));
    const rec = recordFor(evs, programId);
    return {
      key, label: teamLabel(key),
      record: rec.wins + rec.losses + rec.ties > 0 ? rec : null,
      hasExhibition: evs.some((e) => e.exhibition),
      results: rows.filter((r) => !isOpen(r.phase)).reverse(),
      schedule: rows.filter((r) => isOpen(r.phase)),
    };
  });
}

/** The next game worth a feature card: the earliest one not yet over and with a result still to come (in progress counts, pending does not). */
export function nextUp(groups: TeamGroup[]): { group: TeamGroup; row: GameRow } | null {
  let best: { group: TeamGroup; row: GameRow } | null = null;
  for (const group of groups) {
    for (const row of group.schedule) {
      if (row.phase !== 'upcoming' && row.phase !== 'inProgress') continue;
      if (!best || row.startAt < best.row.startAt) best = { group, row };
      break;
    }
  }
  return best;
}

export const recordText = (r: NonNullable<TeamGroup['record']>): string => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;
