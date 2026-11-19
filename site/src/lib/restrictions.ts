/** Fire and water restrictions (Fas 5 source 1, owner 2026-11-19): what the City's Alert Center says, read by
 *  scrapers/parsers/alert_center_restrictions.py into restriction_checks (db/migrations/073_restriction_checks.sql).
 *
 *  Rules (owner, verbatim decision in .claude/specs/fas5-source-inventory.md):
 *  - always the source link and "last checked";
 *  - the newest check failed, or the newest successful check is older than 48 h: "Status unknown, see the source";
 *  - never "no restrictions" as a fallback: the "none" text needs a successful, fresh check whose page said 0 alerts;
 *  - no AI text: the level is the source's own alert title, verbatim; every other string is a fixed template below.
 *
 *  Pure (no DB, no clock of its own): the build and the browser call the same function, so a page built while the data was fresh
 *  still flips to "unknown" in the browser once the 48 h have passed (no rebuild needed). */

export type RestrictionKind = 'fire' | 'water';
export type RestrictionState = 'active' | 'none' | 'unknown';

/** One restriction_checks row, as the site reads it. */
export interface RestrictionCheck {
  kind: RestrictionKind;
  state: RestrictionState;
  title: string | null;
  since_at: string | null;
  alert_count: number | null;
  alert_url: string | null;
  source_url: string;
  checked_at: string;
}

/** Config per kind (site-config.ts `restrictions`): where the source is, used when there is no row at all. */
export interface RestrictionSource { sourceUrl: string }

export const STALE_AFTER_MS = 48 * 3600_000;

export const LABELS: Record<RestrictionKind, string> = { fire: 'Fire restrictions', water: 'Water restrictions' };
export const UNKNOWN_TEXT = 'Status unknown, see the source';
export const NONE_TEXT: Record<RestrictionKind, string> = {
  fire: 'No fire restriction alert posted by the City',
  water: 'No water restriction or drought alert posted by the City',
};

export interface RestrictionView {
  kind: RestrictionKind;
  label: string;
  state: RestrictionState;
  /** The line itself: the source's title (active), a NONE_TEXT (none) or UNKNOWN_TEXT. */
  text: string;
  /** "+1 more alert" when the category lists more than the one shown (template). */
  more: string | null;
  sinceAt: string | null;
  /** The successful check the line is built from; null when there never was one. */
  checkedAt: string | null;
  sourceUrl: string;
  /** ISO instant at which the browser must switch this line to UNKNOWN_TEXT; null when it already is unknown. */
  staleAt: string | null;
  tone: 'quiet' | 'notice';
}

/** latest = the newest row for the kind (any state); lastGood = the newest row whose state is not 'unknown'. */
export function restrictionView(kind: RestrictionKind, latest: RestrictionCheck | null, lastGood: RestrictionCheck | null,
  source: RestrictionSource, now: Date): RestrictionView {
  const base = { kind, label: LABELS[kind], sourceUrl: latest?.source_url ?? source.sourceUrl };
  const unknown: RestrictionView = {
    ...base, state: 'unknown', text: UNKNOWN_TEXT, more: null, sinceAt: null,
    checkedAt: lastGood?.checked_at ?? null, staleAt: null, tone: 'notice',
  };
  if (!latest || latest.state === 'unknown' || !lastGood) return unknown;
  const checked = Date.parse(latest.checked_at);
  if (Number.isNaN(checked) || now.getTime() - checked > STALE_AFTER_MS) return unknown;
  const staleAt = new Date(checked + STALE_AFTER_MS).toISOString();
  if (latest.state === 'none') {
    return { ...base, state: 'none', text: NONE_TEXT[kind], more: null, sinceAt: null, checkedAt: latest.checked_at, staleAt, tone: 'quiet' };
  }
  const title = (latest.title ?? '').trim();
  if (!title) return unknown;
  const extra = (latest.alert_count ?? 1) - 1;
  return {
    ...base, state: 'active', text: title, more: extra > 0 ? `+${extra} more alert${extra === 1 ? '' : 's'}` : null,
    sinceAt: latest.since_at, checkedAt: latest.checked_at, staleAt, tone: 'notice',
  };
}

/** "Nov 17, 2026" in the town's zone. */
export function formatSince(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}

/** "Nov 19, 4:00 PM" in the town's zone. */
export function formatChecked(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
}

/** The meta line under a restriction: "In effect since Nov 17, 2026 · Last checked Nov 19, 4:00 PM" (templates only). */
export function metaLine(v: RestrictionView, timeZone: string): string {
  const parts: string[] = [];
  if (v.state === 'active' && v.sinceAt) parts.push(`In effect since ${formatSince(v.sinceAt, timeZone)}`);
  if (v.checkedAt) parts.push(`${v.state === 'unknown' ? 'Last successful check' : 'Last checked'} ${formatChecked(v.checkedAt, timeZone)}`);
  else parts.push('Not checked yet');
  return parts.join(' · ');
}
