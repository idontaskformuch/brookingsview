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

export interface Source { name: string; url: string }

/** Where a reader can find the answer once it is published: a link, a phone number, or both. */
export type CheckAt =
  | { label: string; url: string; phone?: string }
  | { label: string; phone: string; url?: string };

export interface LastYear { value: string; source: Source }

interface FactBase {
  section: Exclude<HolidaySection, 'events'>;
  label: string;
  /** ISO date (YYYY-MM-DD) the source was last read. Shown on the page. */
  checkedOn: string;
  /** One sentence at most, only to make the value understandable. */
  clarify?: string;
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
} & (
  | { lastYear: LastYear; checkAt?: CheckAt }
  | { checkAt: CheckAt; lastYear?: LastYear }
);

export type HolidayFact = ConfirmedFact | UnconfirmedFact;

export interface EventVenue {
  name: string;
  street: string;
  locality: string;
  region: string;
  postalCode?: string;
}

interface EventBase {
  name: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  checkedOn: string;
  source: Source;
  clarify?: string;
}

export interface ConfirmedEvent extends EventBase {
  status: 'confirmed';
  /** Local 24-hour times, HH:MM. Required for confirmed: no time, no confirmation. */
  startTime: string;
  endTime?: string;
  venue: EventVenue;
  /** The organizer's own page. */
  url: string;
  /** Extra facts such as prices, one short line each. */
  details?: string[];
}

export type UnconfirmedEvent = EventBase & {
  status: 'unconfirmed';
} & (
  | { lastYear: LastYear; checkAt?: CheckAt }
  | { checkAt: CheckAt; lastYear?: LastYear }
);

export type HolidayEvent = ConfirmedEvent | UnconfirmedEvent;

/** A source we must not fetch (robots.txt). Rendered as a plain pointer to the public page. */
export interface LinkOnly { label: string; linkText: string; url: string }

export interface HolidayPageData {
  holiday: string;
  /** Four-digit year the facts are for. */
  year: number;
  townId: string;
  facts: HolidayFact[];
  events: HolidayEvent[];
  linkOnly: LinkOnly[];
  /** Plain navigation to other pages of the site. */
  related: { label: string; href: string }[];
}

/** Hosts whose robots.txt blocks us: they may appear in `linkOnly`, never as a fact source or check pointer. */
export const BLOCKED_SOURCE_HOSTS = ['compass.broomfield.org'];

export function isBlockedHost(url: string): boolean {
  try {
    return BLOCKED_SOURCE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function sectionsWithRows(page: HolidayPageData): HolidaySection[] {
  return SECTION_ORDER.filter((s) =>
    s === 'events' ? page.events.length > 0 : page.facts.some((f) => f.section === s));
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

/** "2026-11-04" -> "Nov 4, 2026". Pure string arithmetic, no time zone. */
export function formatIsoDate(iso: string, long = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const month = MONTHS[Number(m[2]) - 1];
  return `${long ? month : month.slice(0, 3)} ${Number(m[3])}, ${m[1]}`;
}

function joinWords(words: string[]): string {
  return words.join(', ');
}

export interface HolidayMeta { title: string; h1: string; description: string }

/** Deterministic title, H1 and description. Only sections with a confirmed row are named, so the title never
 *  promises what the page does not yet have. `holidayLabel` is e.g. "Thanksgiving". */
export function buildHolidayMeta(page: HolidayPageData, holidayLabel: string, cityName: string): HolidayMeta {
  const confirmed = confirmedSections(page);
  const words = joinWords(confirmed.map((s) => SECTION_META_WORD[s]));
  const h1 = `${holidayLabel} ${page.year}${words ? `: ${words}` : ''}`;
  const title = `${holidayLabel} ${page.year} in ${cityName}${words ? `: ${words}` : ''}`;

  const counts = confirmed.map((s) => {
    const n = s === 'events'
      ? page.events.filter((e) => e.status === 'confirmed').length
      : page.facts.filter((f) => f.section === s && f.status === 'confirmed').length;
    return `${SECTION_META_WORD[s]} (${n})`;
  });
  const pending = sectionsWithRows(page).filter((s) => !confirmed.includes(s));
  const notYet = pending.map((s) => SECTION_META_WORD[s]);
  const parts = [
    counts.length ? `Confirmed: ${joinWords(counts)}.` : '',
    notYet.length ? `Not yet confirmed: ${joinWords(notYet)}.` : '',
    `Last checked ${formatIsoDate(lastChecked(page))}.`,
  ].filter(Boolean);
  return { title, h1, description: `${holidayLabel} ${page.year} in ${cityName}. ${parts.join(' ')}` };
}

/** Local wall-clock date + time in an IANA zone -> ISO string with the zone's offset on that date. */
export function localIso(date: string, time: string, timeZone: string): string {
  const offset = toZonedISOString(`${date}T12:00:00Z`, timeZone).slice(-6);
  return `${date}T${time}:00${offset}`;
}

/** Event JSON-LD for the confirmed events only. An unconfirmed event never gets markup. */
export function buildHolidayEventsJsonLd(page: HolidayPageData, timeZone: string, country = 'US'): Record<string, unknown>[] {
  return page.events.flatMap((e) => {
    if (e.status !== 'confirmed') return [];
    const ld: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: e.name,
      startDate: localIso(e.date, e.startTime, timeZone),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      url: e.url,
      location: {
        '@type': 'Place',
        name: e.venue.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: e.venue.street,
          addressLocality: e.venue.locality,
          addressRegion: e.venue.region,
          ...(e.venue.postalCode ? { postalCode: e.venue.postalCode } : {}),
          addressCountry: country,
        },
      },
    };
    if (e.endTime) ld.endDate = localIso(e.date, e.endTime, timeZone);
    return [ld];
  });
}

/** "17:30" -> "5:30 p.m.", "09:00" -> "9:00 a.m." */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`not a HH:MM time: ${hhmm}`);
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-26" -> "Thu, Nov 26" (weekday from the calendar date itself, no time zone). */
export function formatEventDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${weekday}, ${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${Number(m[3])}`;
}

/** One-line "when and where" for a confirmed event; an unconfirmed one has only its (reference) day. */
export function eventWhenWhere(e: HolidayEvent): string {
  if (e.status !== 'confirmed') return formatEventDay(e.date);
  const time = e.endTime ? `${formatClock(e.startTime)}–${formatClock(e.endTime)}` : formatClock(e.startTime);
  return `${formatEventDay(e.date)} · ${time} · ${e.venue.name}, ${e.venue.street}`;
}
