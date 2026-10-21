/** Election 2026, phase 1 (/vote): types, build-time validation and the pure date helpers.
 *  Spec: .claude/specs/election-2026.md. Dependency-free on purpose -- the same helpers run in
 *  the build and in the page's browser <script> (days left / passed dates are recomputed in the
 *  town's timezone, like every other time-relative surface; the build value is the fallback).
 *
 *  Hard rules enforced HERE, not by convention:
 *   - rule 6: every date, place and link carries a source URL that is listed in `sources`;
 *     assertElectionValid() throws (failing the build) otherwise.
 *   - rule 3: every URL's host must be on the town's `officialHosts` allowlist.
 *   - no AI text: everything rendered comes from the config, nothing is generated. */

export interface SourcedLink { label: string; url: string; source_url: string }

export interface KeyDate {
  id: string;
  /** Calendar date, YYYY-MM-DD, in the town's timezone. */
  date: string;
  label: string;
  /** Optional plain detail line, copied from the source (hours, "allow 7 days"). */
  detail?: string;
  /** Rendered prominently (Broomfield's last recommended mail day). */
  prominent?: boolean;
  source_url: string;
}

export interface VotePlace {
  name: string;
  address: string;
  /** 'early' = before Election Day, 'election_day' = open on Election Day. */
  kind: 'early' | 'election_day';
  /** One line per schedule row, copied from the source. */
  schedule?: string[];
  source_url: string;
}

export interface ElectionConfig {
  enabled: boolean;
  /** YYYY-MM-DD */
  election_date: string;
  authority: { name: string; url: string; phone?: string; phone_note?: string; source_url: string };
  /** Official hosts (exact, or a parent domain) any URL in this block may point to. */
  officialHosts: string[];
  /** Official pages this block was built from, shown under "Sources". */
  sources: { label: string; url: string }[];
  /** Verified against the sources on this date (YYYY-MM-DD); shown as "Last checked". */
  checked_on: string;
  key_dates: KeyDate[];
  registration?: { text: string; link?: SourcedLink; source_url: string };
  mail_ballot?: { text: string; link?: SourcedLink; tracking?: SourcedLink; source_url: string };
  places: VotePlace[];
  places_note?: { text: string; source_url: string };
  /** Link to the official list/lookup -- the list itself is not copied. */
  polling_place_lookup?: SourcedLink;
  drop_boxes?: SourcedLink;
  sample_ballot?: SourcedLink;
  /** Contest names as the official source words them -- names only, no descriptions. */
  ballot: { items: { name: string }[]; source_url: string; note?: string };
  /** Used by phase 2. */
  races_in_scope?: string[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function hostOk(url: string, hosts: string[]): boolean {
  let h: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    h = u.hostname.toLowerCase();
  } catch { return false; }
  return hosts.some((o) => h === o || h.endsWith('.' + o));
}

/** Throws (listing every problem) when the block breaks the sourcing rules. */
export function assertElectionValid(townId: string, cfg: ElectionConfig): void {
  const p: string[] = [];
  const sourceUrls = new Set(cfg.sources.map((s) => s.url));
  const needSource = (what: string, src: string | undefined) => {
    if (!src) p.push(`${what}: no source_url (rule 6 -- a field without a source is not published)`);
    else if (!sourceUrls.has(src)) p.push(`${what}: source_url ${src} is not listed in sources`);
  };
  const needHost = (what: string, url: string | undefined) => {
    if (url && !hostOk(url, cfg.officialHosts)) p.push(`${what}: ${url} is not https on an official host (${cfg.officialHosts.join(', ')})`);
  };
  const link = (what: string, l: SourcedLink | undefined) => {
    if (!l) return;
    needSource(what, l.source_url); needHost(what, l.url);
    if (!l.label.trim()) p.push(`${what}: empty label`);
  };

  if (!YMD.test(cfg.election_date)) p.push(`election_date "${cfg.election_date}" is not YYYY-MM-DD`);
  if (!YMD.test(cfg.checked_on)) p.push(`checked_on "${cfg.checked_on}" is not YYYY-MM-DD`);
  if (cfg.officialHosts.length === 0) p.push('officialHosts is empty');
  for (const s of cfg.sources) needHost(`sources[${s.label}]`, s.url);
  needSource('authority', cfg.authority.source_url); needHost('authority.url', cfg.authority.url);
  if (cfg.key_dates.length === 0) p.push('key_dates is empty');
  const ids = new Set<string>();
  for (const d of cfg.key_dates) {
    if (ids.has(d.id)) p.push(`key_dates: duplicate id ${d.id}`);
    ids.add(d.id);
    if (!YMD.test(d.date)) p.push(`key_dates[${d.id}]: date "${d.date}" is not YYYY-MM-DD`);
    needSource(`key_dates[${d.id}]`, d.source_url);
  }
  if (cfg.registration) { needSource('registration', cfg.registration.source_url); link('registration.link', cfg.registration.link); }
  if (cfg.mail_ballot) {
    needSource('mail_ballot', cfg.mail_ballot.source_url); link('mail_ballot.link', cfg.mail_ballot.link); link('mail_ballot.tracking', cfg.mail_ballot.tracking);
  }
  for (const pl of cfg.places) {
    needSource(`places[${pl.name}]`, pl.source_url);
    if (!pl.address.trim()) p.push(`places[${pl.name}]: empty address`);
  }
  if (cfg.places_note) needSource('places_note', cfg.places_note.source_url);
  link('polling_place_lookup', cfg.polling_place_lookup);
  link('drop_boxes', cfg.drop_boxes);
  link('sample_ballot', cfg.sample_ballot);
  needSource('ballot', cfg.ballot.source_url);

  if (p.length > 0) {
    throw new Error(`Election config for "${townId}" failed the sourcing check (${p.length} problem(s)):\n` + p.map((x) => `  - ${x}`).join('\n'));
  }
}

/** Whole calendar days from `today` (YYYY-MM-DD) to `date`; negative = passed. */
export function daysBetween(today: string, date: string): number {
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = date.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Today's calendar date in an IANA timezone, YYYY-MM-DD. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export type DateStatus = 'upcoming' | 'today' | 'passed';
export function statusFor(today: string, date: string): DateStatus {
  const d = daysBetween(today, date);
  return d > 0 ? 'upcoming' : d === 0 ? 'today' : 'passed';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Monday, October 26" (year omitted when `withYear` is false). Pure calendar math, no timezone. */
export function formatYmd(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

/** Lead sentence under the H1; deterministic text from the date only. */
export function leadSentence(today: string, electionDate: string, cityName: string): string {
  const days = daysBetween(today, electionDate);
  const when = formatYmd(electionDate, true);
  if (days > 1) return `Election Day in ${cityName} is ${when}, ${days} days from today.`;
  if (days === 1) return `Election Day in ${cityName} is tomorrow, ${when}.`;
  if (days === 0) return `Today is Election Day in ${cityName}: ${when}.`;
  return `The ${electionDate.slice(0, 4)} election in ${cityName} was held ${when}. It is over.`;
}

/** Days after the election when /vote becomes noindex (spec: 30). */
export const NOINDEX_AFTER_DAYS = 30;
export function isPastNoindexWindow(today: string, electionDate: string): boolean {
  return daysBetween(electionDate, today) > NOINDEX_AFTER_DAYS;
}
