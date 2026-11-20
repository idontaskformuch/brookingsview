/** Fire and water restrictions (Fas 5 source 1, owner 2026-11-19): what the City's Alert Center category pages say, read by
 *  scrapers/parsers/alert_center_restrictions.py into restriction_checks (db/migrations/073_restriction_checks.sql).
 *
 *  Rules (owner, verbatim decisions in .claude/specs/fas5-source-inventory.md, and the changes of 2026-11-19 evening):
 *  - always the source link and "last checked";
 *  - the newest check failed, or the newest successful check is older than 48 h: "Status unknown, see the source";
 *  - never "no restrictions" as a fallback: the "none" text needs a successful, fresh check whose page said 0 alerts;
 *  - every active alert in the category, the source's own title verbatim, newest first, at most MAX_SHOWN;
 *  - no AI text: every other string is a fixed template below.
 *
 *  Pure (no DB, no clock of its own): the build and the browser call the same function, so a page built while the data was fresh
 *  still flips to "unknown" in the browser once the 48 h have passed (no rebuild needed). */

export type RestrictionKind = 'fire' | 'water';
export type RestrictionState = 'active' | 'none' | 'unknown';

/** One alert as the scraper stored it (restriction_checks.alerts, newest first). */
export interface RestrictionAlert { title: string; since_at: string | null; url: string | null }

/** One restriction_checks row, as the site reads it. */
export interface RestrictionCheck {
  kind: RestrictionKind;
  state: RestrictionState;
  alerts: RestrictionAlert[] | null;
  alert_count: number | null;
  source_url: string;
  checked_at: string;
}

/** Config per kind (site-config.ts `restrictions`): where the source is, used when there is no row at all. */
export interface RestrictionSource { sourceUrl: string }

export const STALE_AFTER_MS = 48 * 3600_000;
export const MAX_SHOWN = 3;

/** The section heading on /safety/ (owner 2026-11-20). */
export const SECTION_TITLE = 'Fire and water restrictions and alerts';
export const LABELS: Record<RestrictionKind, string> = { fire: 'Fire alerts and restrictions', water: 'Water restrictions' };
export const UNKNOWN_TEXT = 'Status unknown, see the source';
export const NONE_TEXT: Record<RestrictionKind, string> = {
  fire: 'No fire restriction alert posted by the City',
  water: 'No water restriction or drought alert posted by the City',
};
/** Must match how often Broomfield's scrape actually runs: cron-dispatcher SCRAPE_CRON '0 11,23 * * *' = twice a day
 *  (traffic.yml's 05/17 UTC runs are --only traffic). restrictions.test.ts checks it against that cron. */
export const CHECK_FREQUENCY_TEXT = 'We check it twice a day.';

export interface RestrictionView {
  kind: RestrictionKind;
  label: string;
  state: RestrictionState;
  /** active: the alerts shown, newest first, at most MAX_SHOWN; otherwise empty. */
  alerts: { title: string; sinceAt: string | null; url: string | null }[];
  /** The one-line text: the titles joined with "; " (active), a NONE_TEXT (none) or UNKNOWN_TEXT. */
  text: string;
  /** "+1 more alert" when the category lists more than MAX_SHOWN (template). */
  more: string | null;
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
    ...base, state: 'unknown', alerts: [], text: UNKNOWN_TEXT, more: null,
    checkedAt: lastGood?.checked_at ?? null, staleAt: null, tone: 'notice',
  };
  if (!latest || latest.state === 'unknown' || !lastGood) return unknown;
  const checked = Date.parse(latest.checked_at);
  if (Number.isNaN(checked) || now.getTime() - checked > STALE_AFTER_MS) return unknown;
  const staleAt = new Date(checked + STALE_AFTER_MS).toISOString();
  if (latest.state === 'none') {
    return { ...base, state: 'none', alerts: [], text: NONE_TEXT[kind], more: null, checkedAt: latest.checked_at, staleAt, tone: 'quiet' };
  }
  const all = (latest.alerts ?? []).filter((a) => a.title.trim() !== '');
  if (all.length === 0) return unknown;
  // Newest first by the alert's own date (the scraper already sorts; sorted again so the rule does not depend on it).
  const sorted = [...all].sort((a, b) => Date.parse(b.since_at ?? '') - Date.parse(a.since_at ?? '') || 0);
  const shown = sorted.slice(0, MAX_SHOWN).map((a) => ({ title: a.title.trim(), sinceAt: a.since_at, url: a.url }));
  const extra = Math.max(latest.alert_count ?? all.length, all.length) - shown.length;
  return {
    ...base, state: 'active', alerts: shown, text: shown.map((a) => a.title).join('; '),
    more: extra > 0 ? `+${extra} more alert${extra === 1 ? '' : 's'}` : null,
    checkedAt: latest.checked_at, staleAt, tone: 'notice',
  };
}

/** "Nov 17, 2026" in the town's zone. */
export function formatPosted(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}

/** "Nov 19, 4:00 PM" in the town's zone. */
export function formatChecked(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
}

/** "Posted Nov 17, 2026" for one alert (template), or null without a date. The date is the alert's own publication date on the City's page (span.date), not when the restriction took effect (owner 2026-11-20). */
export function postedLine(sinceAt: string | null, timeZone: string): string | null {
  return sinceAt ? `Posted ${formatPosted(sinceAt, timeZone)}` : null;
}

/** "Last checked Nov 19, 4:00 PM" / "Last successful check ..." / "Not checked yet" (templates). */
export function checkedLine(v: RestrictionView, timeZone: string): string {
  if (!v.checkedAt) return 'Not checked yet';
  return `${v.state === 'unknown' ? 'Last successful check' : 'Last checked'} ${formatChecked(v.checkedAt, timeZone)}`;
}
