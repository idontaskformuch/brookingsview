/** Capital improvement projects from the City's own list (Fas 5 source 2, owner 2026-11-20). The scraper
 *  (scrapers/parsers/capital_projects.py) writes projects rows with source_type 'cip_page' and a dated project_updates row per
 *  change it sees between two daily checks (db/migrations/074_capital_projects.sql). This module only sorts what the City wrote.
 *
 *  Rules from the owner's decisions (.claude/specs/fas5-source-inventory.md, "Källa 2"):
 *  - No text of our own about a project: the phase lines are shown verbatim, marked "per the City's timeline". The only project text
 *    besides them is one short sentence copied from the City's page (<= 25 words, or none) and the City's cost line.
 *  - The groups are a sort order, not a statement (owner addition 2). "Complete" only when the City marks every phase "(Completed)";
 *    a phase whose end date has passed without that mark keeps the project "In progress", the line shown as the City wrote it.
 *  - A project whose timeline has no line we can read dates from goes in its own group: "Timeline: see the City's page" (decision C).
 *  - Today's date decides the groups at build time; the stored dates come from the parser, which never guesses one. */

export interface CipPhase {
  text: string;
  label: string | null;
  start: string | null; // YYYY-MM-DD
  end: string | null;
  completed: boolean;
  tbd: boolean;
}

export interface CipProject {
  slug: string;
  title: string;
  description: string;
  source_url: string;
  timeline: CipPhase[] | null;
  cost_text: string | null;
  last_checked_at: string | null;
  delisted_at: string | null;
}

export interface CipUpdate {
  entry_date: string;
  change_kind: string;
  body: string;
  source_url: string | null;
}

export type CipGroup = 'in_progress' | 'planned' | 'complete' | 'see_city' | 'delisted';

export const PAGE_H1 = 'Ongoing capital projects (per the City)';
export const TIMELINE_LABEL = "per the City's timeline";

/** Heading per group, in page order. */
export const GROUPS: { key: CipGroup; label: string }[] = [
  { key: 'in_progress', label: 'In progress' },
  { key: 'planned', label: 'Planned' },
  { key: 'complete', label: 'Complete' },
  { key: 'see_city', label: "Timeline: see the City's page" },
  { key: 'delisted', label: "No longer on the City's list" },
];

/** Must match how often the scraper reads the list: configs/broomfield_co.json data_sources.capital_projects.run_at_utc_hours = [11],
 *  one of cron-dispatcher SCRAPE_CRON's two hours, so once a day. capital-projects.test.ts checks it against both. */
export const CHECK_FREQUENCY_TEXT = 'We check it once a day.';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function datedPhases(p: Pick<CipProject, 'timeline'>): CipPhase[] {
  return (p.timeline ?? []).filter((ph) => ph.start && ph.end);
}

export function groupOf(p: Pick<CipProject, 'timeline' | 'delisted_at'>, today: Date): CipGroup {
  if (p.delisted_at) return 'delisted';
  const dated = datedPhases(p);
  const tbd = (p.timeline ?? []).filter((ph) => ph.tbd);
  const readable = [...dated, ...tbd];
  if (readable.length === 0) return 'see_city';
  if (tbd.length === 0 && dated.every((ph) => ph.completed)) return 'complete';
  const day = isoDay(today);
  const started = dated.some((ph) => ph.completed || (ph.start as string) <= day);
  return started ? 'in_progress' : 'planned';
}

/** The next date on the City's timeline from today: an open phase's start when it lies ahead, else its end. Null when none. */
export function nextMilestone(p: Pick<CipProject, 'timeline'>, today: Date): { date: string; phase: CipPhase } | null {
  const day = isoDay(today);
  let best: { date: string; phase: CipPhase } | null = null;
  for (const ph of datedPhases(p)) {
    if (ph.completed) continue;
    const date = (ph.start as string) > day ? (ph.start as string) : (ph.end as string) >= day ? (ph.end as string) : null;
    if (date && (!best || date < best.date)) best = { date, phase: ph };
  }
  return best;
}

/** Projects per group, each sorted by the next milestone (none last, then by title); the delisted group newest first. */
export function groupProjects<T extends CipProject>(projects: T[], today: Date): { key: CipGroup; label: string; projects: T[] }[] {
  return GROUPS.map(({ key, label }) => {
    const inGroup = projects.filter((p) => groupOf(p, today) === key);
    inGroup.sort((a, b) => {
      if (key === 'delisted') return String(b.delisted_at).localeCompare(String(a.delisted_at));
      const na = nextMilestone(a, today)?.date ?? '9999-12-31';
      const nb = nextMilestone(b, today)?.date ?? '9999-12-31';
      return na === nb ? a.title.localeCompare(b.title) : na.localeCompare(nb);
    });
    return { key, label, projects: inGroup };
  }).filter((g) => g.projects.length > 0);
}

/** "Last checked" for the whole list: the newest successful read of any listed project's page. */
export function lastChecked(projects: Pick<CipProject, 'last_checked_at'>[]): string | null {
  return projects.reduce<string | null>((max, p) => (p.last_checked_at && (!max || p.last_checked_at > max) ? p.last_checked_at : max), null);
}

/** Owner decision D: link a CIP project to a /city-hall/projects/ page only on an exact name match (whitespace trimmed), never a guess. */
export function exactNameMatch<T extends { title: string }>(title: string, registry: T[]): T | null {
  const t = title.trim();
  return registry.find((r) => r.title.trim() === t) ?? null;
}

/** "Nov 20, 2026" in the town's time zone (a check time or the day a project left the list). */
export function formatCheckedDate(iso: string, timeZone: string, locale = 'en-US'): string {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}
