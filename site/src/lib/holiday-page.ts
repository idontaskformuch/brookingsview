/** Holiday pages (/thanksgiving/, later /christmas/ ...): data model, deterministic meta and Event JSON-LD.
 *  Owner-ordered 2026-11-04, see .claude/specs/holiday-layer.md.
 *
 *  The page is rendered from data. Every fact carries a value (or an explicit "not confirmed"), the page it came
 *  from and the date it was last checked. The types make a fact without a source or a check date a compile error,
 *  and an unconfirmed fact without either last year's value or a "check here" pointer likewise. No LLM text. */
import { toZonedISOString } from './db';
import type { SeasonDay } from './holiday-season';
import { TITLE_OK_MAX, TITLE_SECTION_PRIORITY, TITLE_WARN_MAX } from '../config/holiday-pages/title-rules';

export type HolidaySection = 'closures' | 'trash' | 'transit' | 'events' | 'help';
/** Render order of the sections. A section without rows is not rendered. */
export const SECTION_ORDER: HolidaySection[] = ['closures', 'trash', 'transit', 'events', 'help'];

/** Date, clock and wording conventions of a page (config/countries/<id>.json `locale`). The section keys in the
 *  data never change with the locale, only the words shown for them. */
export type HolidayLocale = 'en-US' | 'en-GB';

export const SECTION_HEADING: Record<HolidaySection, string> = {
  closures: 'Closures and changed hours',
  trash: 'Trash and recycling',
  transit: 'Transit',
  events: 'Events',
  help: 'Where to get help',
};
/** Words used in title/H1/description for a section that has at least one confirmed row. */
export const SECTION_META_WORD: Record<HolidaySection, string> = {
  closures: 'closures',
  trash: 'trash pickup',
  transit: 'transit',
  events: 'events',
  help: 'food help',
};
/** Where a locale words a section differently from the US default. */
const LOCALE_HEADING: Partial<Record<HolidayLocale, Partial<Record<HolidaySection, string>>>> = {
  'en-GB': { trash: 'Bin collections' },
};
const LOCALE_META_WORD: Partial<Record<HolidayLocale, Partial<Record<HolidaySection, string>>>> = {
  'en-GB': { trash: 'bin collections', help: 'support' },
};
export function sectionHeading(section: HolidaySection, locale: HolidayLocale): string {
  return LOCALE_HEADING[locale]?.[section] ?? SECTION_HEADING[section];
}
export function sectionMetaWord(section: HolidaySection, locale: HolidayLocale): string {
  return LOCALE_META_WORD[locale]?.[section] ?? SECTION_META_WORD[section];
}

export interface Source { name: string; url: string }

/** Where a reader can find the answer once it is published: a link, a phone number, or both. */
export type CheckAt =
  | { label: string; url: string; phone?: string }
  | { label: string; phone: string; url?: string };

/** `season` (e.g. "2025/26") labels the value ("2025/26: ..."); without it the label is the year before the page's. Never "last year". */
export interface LastYear { value: string; source: Source; season?: string }

/** `hours` = standing opening hours: shown under "More", never in the closures table. */
export type FactSection = Exclude<HolidaySection, 'events'> | 'hours';

interface FactBase {
  section: FactSection;
  label: string;
  /** ISO date (YYYY-MM-DD) the source was last read. Shown on the page. */
  checkedOn: string;
  /** One sentence at most, only to make the value understandable. */
  clarify?: string;
  /** Meta description: for a confirmed fact the short phrase that names it ("FISH food bank closed Nov 26–27"),
   *  for an unconfirmed one the short name ("Trash", no longer used in the description since 2026-11-11). A fact without
   *  one is left out of the description. */
  meta?: string;
  /** Confirmed phrases (facts and events) with the same `metaGroup` are merged into one description phrase,
   *  "<group>: <meta>, <meta>", placed where the first of them would have been. */
  metaGroup?: string;
  /** While this row is unconfirmed the page shows no "N places closed" number (hero, front page, /holidays/): owner
   *  2026-11-11, the city's own closures row -- without it, "1 place closed" reads as if only that place shuts. */
  holdsCount?: boolean;
}

/** What a confirmed row means for a reader. Set in the data, never read out of the value text: `closed` (shut, no service),
 *  `changed` (different hours, a moved pickup, reduced service), `open` (runs as usual). A row without it is "good to know". */
export type HolidayChange = 'closed' | 'changed' | 'open';

export interface ConfirmedFact extends FactBase {
  status: 'confirmed';
  value: string;
  source: Source;
  change?: HolidayChange;
  /** A `closed` row that is not shut on the holiday itself (ISO dates it is shut, e.g. a facility closed the Saturday after):
   *  it stays in the Closed group with its own date but is not counted as closed on the day (holiday-view closedPlaces). */
  closedOn?: string[];
  /** The value in the past tense, shown once the holiday is over when `value` speaks of the day in the present
   *  ("Operations run 24/7 on Nov 11" -> "ran"). Owner 2026-11-11: no present tense about the day after it. */
  past?: string;
  /** What the row says on the standing (timeless) page, once its season is over: no date, no tense about a day that has
   *  passed ("George Di Ciero City and County Building, ..."). Without it the standing page shows only the row's name. */
  standing?: string;
  /** One short sentence for the line under the hero (lib/holiday-view.ts holidayInsights): only on a row that changes
   *  something people plan around, such as a moved pickup. Written from the row's own value. */
  insight?: string;
  /** Season pages (lib/holiday-season.ts): the days (YYYY-MM-DD) this row is about; it is shown as a card under each of them,
   *  with `value` as its big line. A row about one place on several days is one row per distinct value. */
  on?: string[];
}

/** Not confirmed for this year. `source` is the page that was read (and said nothing, or not enough). */
export type UnconfirmedFact = FactBase & {
  status: 'unconfirmed';
  source: Source;
  /** Standing hours/terms read from the source, shown as "Usual hours: ..." under the not-confirmed line
   *  (e.g. a food bank's weekly hours while its Christmas hours are not out). Never a 2026 holiday fact. */
  usual?: string;
} & (
  | { lastYear: LastYear; checkAt?: CheckAt }
  | { checkAt: CheckAt; lastYear?: LastYear }
);

export type HolidayFact = ConfirmedFact | UnconfirmedFact;

/** `street` and `region` are left out where the organizer's page does not give them (nothing is looked up elsewhere). */
export interface EventVenue {
  name: string;
  street?: string;
  locality: string;
  region?: string;
  postalCode?: string;
}

interface EventBase {
  name: string;
  checkedOn: string;
  source: Source;
  clarify?: string;
  /** Meta description phrase, e.g. "Turkey Day 5K/10K Nov 26". */
  meta?: string;
  /** See FactBase.metaGroup. */
  metaGroup?: string;
}

/** Hours from `from` to `to` (YYYY-MM-DD, inclusive), on the ISO weekdays in `days` (1 = Monday; absent = every day). `open` null = closed. */
export interface OpenHoursRule { from: string; to: string; days?: number[]; open: string | null; close?: string }

export interface ConfirmedEvent extends EventBase {
  status: 'confirmed';
  /** Local calendar date, YYYY-MM-DD (the first day of a run). */
  date: string;
  /** Last day of a multi-day run, YYYY-MM-DD. */
  endDate?: string;
  /** Local 24-hour times, HH:MM. Without a start time the event is shown but gets no JSON-LD, unless `seasonJsonLd`. */
  startTime?: string;
  endTime?: string;
  /** Every start time of the day when one card stands for several performances (lib/holiday-season.ts, a series), HH:MM. */
  times?: string[];
  /** Emit date-only JSON-LD (startDate/endDate) for a run whose hours vary by day. Needs `endDate`. */
  seasonJsonLd?: boolean;
  /** A run's opening hours day by day, as the organizer's page gives them (the evening layer shows the run on the evenings it is open,
   *  with that day's hours, lib/evening-season.ts). The last rule that covers a day wins. */
  openHours?: OpenHoursRule[];
  venue: EventVenue;
  /** The organizer's own page. */
  url: string;
  /** Extra facts such as prices, one short line each. */
  details?: string[];
  /** `details` once the event is over, when they speak in the present tense ("provide refreshments"). */
  pastDetails?: string[];
  /** Outside the town (the /events/ pipeline's "nearby" zone): shown as "Nearby" with the distance when it is known. */
  nearby?: { miles: number | null };
  /** Key of the calendar row it was matched from (lib/holiday-calendar-events.ts), e.g. "event-329806". Such a row has
   *  its own page with its own markup, so the holiday page emits no Event JSON-LD for it. */
  fromCalendar?: string;
  /** A row from a feed read again at every build (Ticketmaster): its checkedOn is the build day, so the page's checked dates leave it out
   *  (owner 2026-11-15) and a build alone never moves "Checked". Calendar and venue-register rows are not feed rows. */
  feed?: true;
}

export type UnconfirmedEvent = EventBase & {
  status: 'unconfirmed';
  /** Reference day only when there is one (last year's); never shown as a 2026 fact. */
  date?: string;
} & (
  | { lastYear: LastYear; checkAt?: CheckAt }
  | { checkAt: CheckAt; lastYear?: LastYear }
);

export type HolidayEvent = ConfirmedEvent | UnconfirmedEvent;

/** A source we must not fetch (robots.txt, a 403), or one the owner wants only linked (ScotRail's timetable, SPT, 2026-11-14).
 *  Rendered as a plain pointer to the public page. */
export interface LinkOnly {
  label: string;
  linkText: string;
  url: string;
  /** Rows with the same group are listed together under that heading (e.g. "Other bus and coach operators"). */
  group?: string;
}

export interface HolidayPageData {
  holiday: string;
  /** Four-digit year the facts are for. */
  year: number;
  locale: HolidayLocale;
  townId: string;
  facts: HolidayFact[];
  events: HolidayEvent[];
  linkOnly: LinkOnly[];
  /** Fixed title/H1/description for a page whose wording the owner approved word for word (/veterans-day/).
   *  Replaces what buildHolidayMeta would derive; still data, never generated text. */
  metaOverride?: HolidayMeta;
  /** The same, used outside the page window (no year, no date; the page is then showing a past season's facts). */
  metaOverrideEvergreen?: HolidayMeta;
  /** The day a row's value, status or source last changed (config/holiday-pages/data-updated.json). Sitemap
   *  lastmod and the page's dateModified. Not the check date, not the build date. */
  dataUpdatedOn: string;
  /** Plain navigation to other pages of the site. */
  related: { label: string; href: string }[];
  /** The page's name in the title and description when it is wider than the holiday ("Christmas and New Year"). */
  label?: string;
  /** Fixed H1 (owner-approved wording, "Christmas and New Year in Glasgow"). */
  h1?: string;
  /** Title topics in the owner's order (US Christmas, owner 2026-11-18): "<titleLabel> [<year>] in <Town>: <topics>". A topic with
   *  `event` needs a confirmed event of that exact name, `closed` any confirmed `closed` row, `events` any confirmed event; a topic whose
   *  condition fails is left out. When an `event` topic (the headline) is not confirmed, the title falls back to the derived section
   *  words ("closures, trash pickup, events"). See titleTopicsFor. */
  titleTopics?: { text: string; event?: string; closed?: true; events?: true }[];
  /** The holiday name in the title, the fallback title included ("Christmas"); the page label (`label`) stays for the H1 and elsewhere. */
  titleLabel?: string;
  /** Confirmed events outside the town with a known distance get their own "Nearby" group after Events, each with "about N min drive"
   *  (US Christmas pages, owner 2026-11-18, NB1; the same estimate as What's On, lib/evening-items.ts driveMinutes). */
  nearbySection?: true;
  /** No "N places closed" anywhere (hero, front page, /holidays/): the confirmed rows are a small part of what closes (Glasgow). */
  noClosedCount?: boolean;
  /** Day-by-day sections (lib/holiday-season.ts), rendered by components/HolidaySeasonPage.astro while the window is open. */
  season?: { days: SeasonDay[] };
  /** Extra front-page posts with their own visible days (local, inclusive) and the days the deck counts down to, e.g.
   *  "Hogmanay and New Year" 27 Dec to the last bank holiday (owner 2026-11-14). */
  frontPage?: { label: string; from: string; to: string; anchor: string; deckDays: { label: string; date: string }[] }[];
}

/** Hosts whose robots.txt blocks us: they may appear in `linkOnly`, never as a fact source or check pointer. */
export const BLOCKED_SOURCE_HOSTS = [
  'compass.broomfield.org',
  // 403 to a plain client even though robots.txt allows (owner rule 2026-11-04, CLAUDE.md #13): link-only.
  'www.mcgillsbuses.co.uk', 'www.stagecoachbus.com', 'www.citylink.co.uk', 'www.firstbus.co.uk',
  // robots.txt disallows AI crawlers (ClaudeBot, anthropic-ai) site-wide.
  'seinglasgow.org.uk',
];

export function isBlockedHost(url: string): boolean {
  try {
    return BLOCKED_SOURCE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A page exists for a town only with at least one confirmed row (a fact or an event) from an official source. */
export function hasConfirmedRow(page: HolidayPageData): boolean {
  return page.facts.some((f) => f.status === 'confirmed') || page.events.some((e) => e.status === 'confirmed');
}

export function sectionsWithRows(page: HolidayPageData): HolidaySection[] {
  return SECTION_ORDER.filter((s) =>
    s === 'events' ? page.events.length > 0 : page.facts.some((f) => f.section === s));
}

/** Standing opening hours (rendered under "More"). */
export function regularHours(page: HolidayPageData): HolidayFact[] {
  return page.facts.filter((f) => f.section === 'hours');
}

function confirmedSections(page: HolidayPageData): HolidaySection[] {
  return SECTION_ORDER.filter((s) =>
    s === 'events'
      ? page.events.some((e) => e.status === 'confirmed')
      : page.facts.some((f) => f.section === s && f.status === 'confirmed'));
}

/** checkedOn of every fact and event except feed rows (ConfirmedEvent.feed); a page made only of feed rows keeps their dates. */
export function checkedDates(page: HolidayPageData): string[] {
  const all = [...page.facts, ...page.events];
  if (all.length === 0) throw new Error('holiday page has no facts');
  const read = all.filter((r) => !('feed' in r && r.feed));
  return (read.length ? read : all).map((r) => r.checkedOn);
}

/** Latest checkedOn over the page's rows, feed rows left out (YYYY-MM-DD). */
export function lastChecked(page: HolidayPageData): string {
  return checkedDates(page).reduce((a, b) => (a > b ? a : b));
}

/** Oldest and newest checkedOn over the rows of the page, feed rows left out (YYYY-MM-DD; equal when every row was read the same day).
 *  The heading and the description show the span, not only the newest date, so a page where one row was reread
 *  does not read as if all of it was (owner 2026-11-14). */
export function checkedSpan(page: HolidayPageData): { first: string; last: string } {
  const dates = checkedDates(page);
  return { first: dates.reduce((a, b) => (a < b ? a : b)), last: dates.reduce((a, b) => (a > b ? a : b)) };
}

/** "Nov 14, 2026", or a span: "Oct 23 – Nov 14, 2026" (a year only at the end when both are in it), "Dec 30, 2025 –
 *  Jan 2, 2026"; en-GB "23 Oct – 14 Nov 2026". `long` writes the month in full. */
export function formatCheckedSpan(span: { first: string; last: string }, long = false, locale: HolidayLocale = 'en-US'): string {
  const last = formatIsoDate(span.last, long, locale);
  if (span.first === span.last) return last;
  const first = formatIsoDate(span.first, long, locale);
  const sameYear = span.first.slice(0, 4) === span.last.slice(0, 4);
  const firstShort = sameYear ? first.replace(locale === 'en-GB' ? / \d{4}$/ : /, \d{4}$/, '') : first;
  return `${firstShort} – ${last}`;
}

const MONTHS = ['January','February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-04" -> "Nov 4, 2026" (en-GB: "4 Nov 2026"). Pure string arithmetic, no time zone. */
export function formatIsoDate(iso: string, long = false, locale: HolidayLocale = 'en-US'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const month = MONTHS[Number(m[2]) - 1];
  const name = long ? month : month.slice(0, 3);
  return locale === 'en-GB' ? `${Number(m[3])} ${name} ${m[1]}` : `${name} ${Number(m[3])}, ${m[1]}`;
}

function joinWords(words: string[]): string {
  return words.join(', ');
}

export interface HolidayMeta { title: string; h1: string; description: string }

/** Meta descriptions stay under this many characters (search results cut near 155-160). */
export const DESCRIPTION_MAX = 155;

/** Priority for naming confirmed items in the description: events, closures, help, then the rest. */
const DESCRIPTION_ORDER: HolidaySection[] = ['events', 'closures', 'help', 'trash', 'transit'];

/** "a", "a and b", "a, b and c". */
export function listWords(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Title, H1 and description of the standing (timeless) page (lib/holiday-view isTimeless): what is normally closed or
 *  different, by name, and the next date; no year in the title, no dated item, nothing in the past tense. */
export function buildTimelessHolidayMeta(page: HolidayPageData, holidayLabel: string, cityName: string, nextDay: number): HolidayMeta {
  const names = page.facts.flatMap((f) => (f.status === 'confirmed' && (f.change === 'closed' || f.change === 'changed') && f.section !== 'hours' ? [f.label] : []));
  const words = names.length ? ': closures' : '';
  const next = new Date(nextDay);
  const nextLabel = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][next.getUTCDay()]}, ${formatIsoDate(next.toISOString().slice(0, 10), true, page.locale)}`;
  const closedLine = names.length ? `What is normally closed or different in ${cityName} on ${holidayLabel}. ` : '';
  return {
    title: `${page.label ?? holidayLabel} in ${cityName}${words}`,
    h1: page.h1 ?? `${holidayLabel}${words}`,
    description: `${closedLine}Next ${holidayLabel}: ${nextLabel}.`,
  };
}

/** Deterministic title, H1 and description. Title and H1 name only sections with a confirmed row, so they never
 *  promise what the page does not yet have. The description names the confirmed items themselves (their `meta`
 *  phrases, in DESCRIPTION_ORDER), then the check date, and drops whole phrases
 *  from the end of the confirmed list to stay within DESCRIPTION_MAX. `holidayLabel` is e.g. "Thanksgiving". */
/** The title words from `titleTopics`, in their order, or null when the page has none or its headline event is not confirmed (then
 *  the derived section words are used). Only confirmed rows count. */
export function titleTopicsFor(page: HolidayPageData): string[] | null {
  if (!page.titleTopics) return null;
  const confirmedEvents = page.events.filter((e) => e.status === 'confirmed');
  const hasEvent = (name: string) => confirmedEvents.some((e) => e.name === name);
  if (page.titleTopics.some((t) => t.event && !hasEvent(t.event))) return null;
  const closed = page.facts.some((f) => f.status === 'confirmed' && f.change === 'closed');
  const kept = page.titleTopics.filter((t) => (!t.closed || closed) && (!t.events || confirmedEvents.length > 0));
  return kept.length ? kept.map((t) => t.text) : null;
}

/** The section words in the fixed title priority (config/holiday-pages/title-rules.ts), only sections with a confirmed row. */
export function titleSectionWords(page: HolidayPageData): string[] {
  const confirmed = new Set(confirmedSections(page));
  return TITLE_SECTION_PRIORITY.filter((s) => confirmed.has(s)).map((s) => sectionMetaWord(s, page.locale));
}

/** "<prefix>: <words>", striking words from the end (lowest priority first) while over TITLE_OK_MAX; at least one word stays. */
export function fitTitle(prefix: string, words: string[]): string {
  const kept = [...words];
  const make = () => (kept.length ? `${prefix}: ${kept.join(', ')}` : prefix);
  while (make().length > TITLE_OK_MAX && kept.length > 1) kept.pop();
  return make();
}

/** Title length rule for every town (owner 2026-11-18): <=65 characters ok, 66-70 a build warning, >70 a build error. After fitTitle a
 *  title is only over 70 with one word left (or none and the prefix alone too long). */
export function titleLengthVerdict(title: string): 'ok' | 'warn' | 'error' {
  return title.length <= TITLE_OK_MAX ? 'ok' : title.length <= TITLE_WARN_MAX ? 'warn' : 'error';
}

/** The build check both page templates run on their title: throws on an error, logs "[holiday-title]" on a warning. */
export function checkTitleLength(title: string): void {
  const v = titleLengthVerdict(title);
  if (v === 'error') throw new Error(`holiday title over ${TITLE_WARN_MAX} characters (${title.length}) even with one word left: ${title}`);
  if (v === 'warn') console.warn(`[holiday-title] ${title.length} characters (${TITLE_OK_MAX + 1}-${TITLE_WARN_MAX} = warning): ${title}`);
}

export function buildHolidayMeta(page: HolidayPageData, holidayLabel: string, cityName: string, evergreen = false): HolidayMeta {
  if (evergreen ? page.metaOverrideEvergreen : page.metaOverride) return (evergreen ? page.metaOverrideEvergreen : page.metaOverride) as HolidayMeta;
  const confirmed = confirmedSections(page);
  const words = joinWords(confirmed.map((s) => sectionMetaWord(s, page.locale)));
  const label = page.label ?? holidayLabel;
  // Outside the window the title and H1 carry no year (the page is a standing page); the description does, because it names the season's facts.
  const h1 = page.h1 ?? (evergreen ? `${label}${words ? `: ${words}` : ''}` : `${label} ${page.year}${words ? `: ${words}` : ''}`);
  const titleLabel = page.titleLabel ?? label;
  const title = fitTitle(
    evergreen ? `${titleLabel} in ${cityName}` : `${titleLabel} ${page.year} in ${cityName}`,
    titleTopicsFor(page) ?? titleSectionWords(page),
  );
  const seasonPrefix = evergreen ? `${page.year}: ` : '';

  const items: { text: string; group?: string }[] = [];
  for (const s of DESCRIPTION_ORDER) {
    if (s === 'events') {
      for (const e of page.events) if (e.status === 'confirmed' && e.meta) items.push({ text: e.meta, group: e.metaGroup });
    } else {
      for (const f of page.facts) if (f.section === s && f.status === 'confirmed' && f.meta) items.push({ text: f.meta, group: f.metaGroup });
    }
  }
  // Same group -> one phrase at the position of its first member.
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.group) { phrases.push(it.text); continue; }
    if (seen.has(it.group)) continue;
    seen.add(it.group);
    phrases.push(`${it.group}: ${items.filter((x) => x.group === it.group).map((x) => x.text).join(', ')}`);
  }
  // Only what is confirmed: rows still waiting for this year's notice are not announced as missing (F9, 2026-11-11).
  const tail = ` Checked ${formatCheckedSpan(checkedSpan(page), false, page.locale)}.`;

  const kept = [...phrases];
  while (kept.length > 0 && seasonPrefix.length + kept.join(' · ').length + 1 + tail.length > DESCRIPTION_MAX) kept.pop();
  const head = kept.length ? `${seasonPrefix}${kept.join(' · ')}.` : '';
  const description = (head + tail).trim();
  return { title, h1, description };
}

/** Local wall-clock date + time in an IANA zone -> ISO string with the zone's offset on that date. */
export function localIso(date: string, time: string, timeZone: string): string {
  const offset = toZonedISOString(`${date}T12:00:00Z`, timeZone).slice(-6);
  return `${date}T${time}:00${offset}`;
}

/** Today's local calendar date (YYYY-MM-DD) in an IANA zone. */
export function localToday(nowMs: number, timeZone: string): string {
  return toZonedISOString(new Date(nowMs).toISOString(), timeZone).slice(0, 10);
}

/** True once the event's last day (the day itself for a one-day event) is before today. */
export function isEventPast(e: HolidayEvent, today: string): boolean {
  if (e.status !== 'confirmed') return false;
  return (e.endDate ?? e.date) < today;
}

/** Event JSON-LD for the confirmed events only. An unconfirmed event never gets markup, nor does a confirmed one
 *  without a start time, unless it is a run flagged `seasonJsonLd` (date-only startDate/endDate). With `today`
 *  (local date), an event whose last day has passed gets none: markup is only for events still ahead. */
export function buildHolidayEventsJsonLd(page: HolidayPageData, timeZone: string, country = 'US', today?: string): Record<string, unknown>[] {
  return page.events.flatMap((e) => {
    if (e.status !== 'confirmed' || e.fromCalendar) return [];
    if (today !== undefined && isEventPast(e, today)) return [];
    const season = e.seasonJsonLd === true && e.endDate !== undefined;
    if (!e.startTime && !season) return [];
    const address: Record<string, unknown> = { '@type': 'PostalAddress' };
    if (e.venue.street) address.streetAddress = e.venue.street;
    address.addressLocality = e.venue.locality;
    if (e.venue.region) address.addressRegion = e.venue.region;
    if (e.venue.postalCode) address.postalCode = e.venue.postalCode;
    address.addressCountry = country;
    const ld: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: e.name,
      startDate: e.startTime ? localIso(e.date, e.startTime, timeZone) : e.date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      url: e.url,
      location: { '@type': 'Place', name: e.venue.name, address },
    };
    if (e.endTime) ld.endDate = localIso(e.endDate ?? e.date, e.endTime, timeZone);
    else if (e.endDate) ld.endDate = e.endDate;
    return [ld];
  });
}

/** "17:30" -> "5:30 p.m.", "09:00" -> "9:00 a.m."; en-GB: "5:30pm", "9am", "12 noon", "midnight". */
export function formatClock(hhmm: string, locale: HolidayLocale = 'en-US'): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`not a HH:MM time: ${hhmm}`);
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (locale === 'en-GB') {
    if (hhmm === '12:00') return '12 noon';
    if (hhmm === '00:00') return 'midnight';
    return `${h12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}`;
  }
  return `${h12}:${m[2]} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-26" -> "Thu, Nov 26" (en-GB: "Thu 26 Nov"); weekday from the calendar date itself, no time zone. */
export function formatEventDay(iso: string, locale: HolidayLocale = 'en-US'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  const month = MONTHS[Number(m[2]) - 1].slice(0, 3);
  return locale === 'en-GB' ? `${weekday} ${Number(m[3])} ${month}` : `${weekday}, ${month} ${Number(m[3])}`;
}

/** One-line "when and where" for a confirmed event; an unconfirmed one has only its (reference) day, if any. `distance` replaces the
 *  "Nearby, N mi away" part (the Nearby group's "about N min drive"). */
export function eventWhenWhere(e: HolidayEvent, locale: HolidayLocale = 'en-US', distance?: string): string {
  if (e.status !== 'confirmed') return e.date ? formatEventDay(e.date, locale) : '';
  const first = formatEventDay(e.date, locale);
  const day = e.endDate && e.endDate !== e.date ? `${first} – ${formatEventDay(e.endDate, locale)}` : first;
  const time = e.startTime
    ? e.endTime ? `${formatClock(e.startTime, locale)}–${formatClock(e.endTime, locale)}` : formatClock(e.startTime, locale)
    : null;
  const place = e.venue.street ? `${e.venue.name}, ${e.venue.street}` : e.venue.name;
  // Same wording as the Nearby list on /events/ ("13 mi away").
  const nearby = distance ?? (e.nearby ? (e.nearby.miles != null ? `Nearby, ${Math.round(e.nearby.miles)} mi away` : 'Nearby') : null);
  return [day, time, place, nearby].filter((p): p is string => p !== null).join(' · ');
}

/** One rendered table row (fact or event), see components/HolidayTable.astro. */
export interface HolidayRow {
  what: string;
  value: string | null;
  clarify?: string;
  usual?: string;
  lastYear?: LastYear;
  checkAt?: CheckAt;
  extra?: string[];
  source: Source;
  checkedOn: string;
}
