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
import { DESCRIPTION_MAX } from './meta-description';

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

/** How a project came to be 'complete': every dated phase marked "(Completed)" by the City, or the City's own summary sentence
 *  (owner 2026-11-20). Null when the project is not 'complete'. Shown in the label: "Complete · per City summary". */
export type CompleteSource = 'timeline' | 'summary';

// Owner 2026-11-20, strict: only the City's own summary sentence under the heading counts, the whole sentence, with the project's
// name in it. "<name> project is now complete." or "<name> ... has been / was completed". Never a phase or part ("Phase 1 is now
// complete"), never the future or almost ("will be complete by 2027", "nearing completion").
const NOT_WHOLE = /\b(phase|phases|part|parts|portion|partially|partly|substantially|mostly|section|segment|stage|first|initial|will|nearing|near|almost|expected|anticipated|scheduled)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function summarySaysComplete(p: Pick<CipProject, 'title' | 'description'>): boolean {
  const name = escapeRe(p.title.trim()).replace(/\s+/g, '\\s+');
  const nowComplete = new RegExp(`^(?:the\\s+)?${name}\\s+project\\s+is\\s+now\\s+complete\\.$`, 'i');
  const wasCompleted = new RegExp(`${name}\\b.*\\b(?:has\\s+been|was)\\s+completed\\b`, 'i');
  const sentences = (p.description ?? '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  // The negative words are checked outside the project's own name ("Phase 2 Trail" in a name would otherwise block it).
  return sentences.some((x) => !NOT_WHOLE.test(x.replace(new RegExp(name, 'i'), '')) && (nowComplete.test(x) || wasCompleted.test(x)));
}

const ONGOING = /\b(ongoing|in progress|underway|currently)\b/i;

/** Owner 2026-11-20: a Timeline line with a date after today, a TBD line, or a line saying the work is ongoing wins over "complete".
 *  Also the QA rule (qa/checks.json cip.complete-no-future-date): no 'complete' project has a line dated after today. */
export function timelineSaysOpen(p: Pick<CipProject, 'timeline'>, today: Date): boolean {
  const day = isoDay(today);
  const year = today.getUTCFullYear();
  return (p.timeline ?? []).some((ph) =>
    (ph.start != null && ph.start > day) || (ph.end != null && ph.end > day) || ph.tbd
    || (!ph.completed && ONGOING.test(ph.text))
    || [...ph.text.matchAll(/\b(20\d{2})\b/g)].some((m) => Number(m[1]) > year)); // an unread year after this one ("2027")
}

export function completeSource(p: Pick<CipProject, 'title' | 'description' | 'timeline' | 'delisted_at'>, today: Date): CompleteSource | null {
  if (p.delisted_at || timelineSaysOpen(p, today)) return null;
  const dated = datedPhases(p);
  if (dated.length > 0 && dated.every((ph) => ph.completed)) return 'timeline';
  return summarySaysComplete(p) ? 'summary' : null;
}

export function groupOf(p: Pick<CipProject, 'title' | 'description' | 'timeline' | 'delisted_at'>, today: Date): CipGroup {
  if (p.delisted_at) return 'delisted';
  if (completeSource(p, today)) return 'complete';
  const dated = datedPhases(p);
  const tbd = (p.timeline ?? []).filter((ph) => ph.tbd);
  const readable = [...dated, ...tbd];
  if (readable.length === 0) return 'see_city';
  const day = isoDay(today);
  const started = dated.some((ph) => ph.completed || (ph.start as string) <= day);
  return started ? 'in_progress' : 'planned';
}

/** The group label for one project: "Complete · per City summary" when the City's summary, not its timeline, made it complete. */
export function groupLabelOf(p: Pick<CipProject, 'title' | 'description' | 'timeline' | 'delisted_at'>, today: Date): string {
  const label = GROUPS.find((g) => g.key === groupOf(p, today))!.label;
  return completeSource(p, today) === 'summary' ? `${label} · per City summary` : label;
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

/** Meta descriptions (2026-11-20, first live battery: /projects/ and long-titled project pages were cut with "…"). Each ends on a whole
 *  sentence within DESCRIPTION_MAX: the longest template that fits is used, so fitDescription never has to cut a word. */
export function cipIndexDescription(cityName: string): string {
  return firstThatFits([
    `The City of ${cityName}'s current capital improvement projects, each phase and date exactly as the City lists them, sorted by where the timeline stands.`,
    `The City of ${cityName}'s current capital improvement projects, each phase and date exactly as the City lists them.`,
    `The City's current capital improvement projects, each phase and date exactly as the City lists them.`,
  ]);
}

export function cipProjectDescription(title: string, cityName: string): string {
  return firstThatFits([
    `${title}: the City of ${cityName}'s timeline for this capital improvement project, word for word, and the changes we have seen to it.`,
    `${title}: the City's timeline for this project, word for word, and every change we have seen.`,
    `${title}: the City's timeline, word for word, and every change we have seen.`,
    `The City's timeline for this capital improvement project, word for word, and every change we have seen.`,
  ]);
}

function firstThatFits(texts: string[]): string {
  return texts.find((t) => t.length <= DESCRIPTION_MAX) ?? texts[texts.length - 1];
}
