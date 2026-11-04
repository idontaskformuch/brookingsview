/** Holiday pages (/thanksgiving/, later /christmas/ ...): data model, deterministic meta and Event JSON-LD.
 *  Owner-ordered 2026-11-04, see .claude/specs/holiday-layer.md.
 *
 *  The page is rendered from data. Every fact carries a value (or an explicit "not confirmed"), the page it came
 *  from and the date it was last checked. The types make a fact without a source or a check date a compile error,
 *  and an unconfirmed fact without either last year's value or a "check here" pointer likewise. No LLM text. */
import { toZonedISOString } from './db';

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
   *  for an unconfirmed one the short name ("Trash"). A fact without one is left out of the description. */
  meta?: string;
  /** Confirmed phrases (facts and events) with the same `metaGroup` are merged into one description phrase,
   *  "<group>: <meta>, <meta>", placed where the first of them would have been. */
  metaGroup?: string;
}

export interface ConfirmedFact extends FactBase {
  status: 'confirmed';
  value: string;
  source: Source;
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

export interface ConfirmedEvent extends EventBase {
  status: 'confirmed';
  /** Local calendar date, YYYY-MM-DD (the first day of a run). */
  date: string;
  /** Last day of a multi-day run, YYYY-MM-DD. */
  endDate?: string;
  /** Local 24-hour times, HH:MM. Without a start time the event is shown but gets no JSON-LD, unless `seasonJsonLd`. */
  startTime?: string;
  endTime?: string;
  /** Emit date-only JSON-LD (startDate/endDate) for a run whose hours vary by day. Needs `endDate`. */
  seasonJsonLd?: boolean;
  venue: EventVenue;
  /** The organizer's own page. */
  url: string;
  /** Extra facts such as prices, one short line each. */
  details?: string[];
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

/** A source we must not fetch (robots.txt). Rendered as a plain pointer to the public page. */
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
}

/** Hosts whose robots.txt blocks us: they may appear in `linkOnly`, never as a fact source or check pointer. */
export const BLOCKED_SOURCE_HOSTS = [
  'compass.broomfield.org',
  // 403 to a plain client even though robots.txt allows (owner rule 2026-11-04, CLAUDE.md #13): link-only.
  'www.mcgillsbuses.co.uk', 'www.stagecoachbus.com', 'www.citylink.co.uk',
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

/** Latest checkedOn over every fact and event (YYYY-MM-DD). */
export function lastChecked(page: HolidayPageData): string {
  const dates = [...page.facts.map((f) => f.checkedOn), ...page.events.map((e) => e.checkedOn)];
  if (dates.length === 0) throw new Error('holiday page has no facts');
  return dates.reduce((a, b) => (a > b ? a : b));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

/** A common-noun name written in lower case in the data ("bins") starts the sentence with a capital. */
function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listWords(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Deterministic title, H1 and description. Title and H1 name only sections with a confirmed row, so they never
 *  promise what the page does not yet have. The description names the confirmed items themselves (their `meta`
 *  phrases, in DESCRIPTION_ORDER), then what is not yet confirmed, then the check date, and drops whole phrases
 *  from the end of the confirmed list to stay within DESCRIPTION_MAX. `holidayLabel` is e.g. "Thanksgiving". */
export function buildHolidayMeta(page: HolidayPageData, holidayLabel: string, cityName: string, evergreen = false): HolidayMeta {
  if (evergreen ? page.metaOverrideEvergreen : page.metaOverride) return (evergreen ? page.metaOverrideEvergreen : page.metaOverride) as HolidayMeta;
  const confirmed = confirmedSections(page);
  const words = joinWords(confirmed.map((s) => sectionMetaWord(s, page.locale)));
  // Outside the window the title and H1 carry no year (the page is a standing page); the description does, because it names the season's facts.
  const h1 = evergreen ? `${holidayLabel}${words ? `: ${words}` : ''}` : `${holidayLabel} ${page.year}${words ? `: ${words}` : ''}`;
  const title = evergreen ? `${holidayLabel} in ${cityName}${words ? `: ${words}` : ''}` : `${holidayLabel} ${page.year} in ${cityName}${words ? `: ${words}` : ''}`;
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
  const pendingNames = page.facts.flatMap((f) => (f.status === 'unconfirmed' && f.meta ? [f.meta] : []));
  const tail = [
    pendingNames.length ? ` ${upperFirst(listWords(pendingNames))} not yet confirmed.` : '',
    ` Checked ${formatIsoDate(lastChecked(page), false, page.locale)}.`,
  ].join('');

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
    if (e.status !== 'confirmed') return [];
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

/** One-line "when and where" for a confirmed event; an unconfirmed one has only its (reference) day, if any. */
export function eventWhenWhere(e: HolidayEvent, locale: HolidayLocale = 'en-US'): string {
  if (e.status !== 'confirmed') return e.date ? formatEventDay(e.date, locale) : '';
  const first = formatEventDay(e.date, locale);
  const day = e.endDate && e.endDate !== e.date ? `${first} – ${formatEventDay(e.endDate, locale)}` : first;
  const time = e.startTime
    ? e.endTime ? `${formatClock(e.startTime, locale)}–${formatClock(e.endTime, locale)}` : formatClock(e.startTime, locale)
    : null;
  const place = e.venue.street ? `${e.venue.name}, ${e.venue.street}` : e.venue.name;
  return [day, time, place].filter((p): p is string => p !== null).join(' · ');
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
