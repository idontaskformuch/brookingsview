/** /help/ (spec .claude/specs/help-resources.md Phase 3): which entries the page shows, and so how many it has. Owner 2026-11-27: the
 *  page and the min_entries alarm (scripts/watch_sources.py) use THE SAME count, and every visible entry counts, warm_space roles too.
 *  The rule lives in db/help_places.py (help_entry_visible / count_visible); this is its mirror for the build. Both are run on the
 *  same cases, tests/fixtures/help_visibility_*.json (help-visibility.test.ts here, tests/test_help_places.py there), so a change to
 *  one that is not made to the other fails a test. Rows are snake_case, as the SQL returns them. */

/** db/help_places.py ENABLED_CATEGORIES: assistance_program and free_clinic are stored but not shown yet. */
export const HELP_ENABLED_CATEGORIES: ReadonlySet<string> = new Set(['food_pantry', 'meal_program', 'warm_space']);
const PUBLISHED_KINDS: ReadonlySet<string> = new Set(['official', 'operator']);
/** help_places.MAX_AGE_DAYS and MIN_ENTRIES (owner decision 1: under 6 the town has no /help/ page). */
export const HELP_MAX_AGE_DAYS = 45;
export const HELP_MIN_ENTRIES = 6;

type Day = string | Date | null | undefined;
export interface HelpVisibilityRow {
  category?: string | null;
  role?: string | null;
  services?: string[] | null;
  source_kind?: string | null;
  verification_status?: string | null;
  verified_date?: Day;
  valid_from?: Day;
  valid_to?: Day;
}

/** "YYYY-MM-DD" of a DATE column (neon returns DATE as a string; a Date is read as UTC midnight, as the driver makes it). */
const ymd = (d: Day): string | null => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const dayNum = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86_400_000);

function inSeason(r: HelpVisibilityRow, today: string): boolean {
  const from = ymd(r.valid_from), to = ymd(r.valid_to);
  return (from === null || from <= today) && (to === null || today <= to);
}

function fresh(r: HelpVisibilityRow, today: string, maxAgeDays: number): boolean {
  const checked = ymd(r.verified_date);
  return r.verification_status === 'verified' && PUBLISHED_KINDS.has(r.source_kind ?? '') && checked !== null
    && dayNum(today) - dayNum(checked) <= maxAgeDays;
}

/** help_places.help_entry_visible: a help place (is_visible) or a role row (role_active on the host place's services). */
export function helpVisible(r: HelpVisibilityRow, today: string, maxAgeDays = HELP_MAX_AGE_DAYS): boolean {
  if (r.role != null) return (r.services ?? []).includes(r.role) && fresh(r, today, maxAgeDays) && inSeason(r, today);
  return HELP_ENABLED_CATEGORIES.has(r.category ?? '') && fresh(r, today, maxAgeDays) && inSeason(r, today);
}

/** help_places.count_visible. */
export const countVisible = (rows: HelpVisibilityRow[], today: string, maxAgeDays = HELP_MAX_AGE_DAYS): number =>
  rows.filter((r) => helpVisible(r, today, maxAgeDays)).length;

/** help_places.page_has_enough: the page is built (when the town's flag is on) only at or over min_entries. */
export const helpPageHasEnough = (visible: number, minEntries = HELP_MIN_ENTRIES): boolean => visible >= minEntries;
