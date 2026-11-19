/** The daily front page's lead slot: one lead and 2-3 secondaries, chosen by rule from what the site already holds. Pure: `selectFrontPage(input, now)`
 *  takes the town's settings and its data, and every date and time is worked out in the town's own timezone (local-day.ts), never the build
 *  machine's or the visitor's.
 *
 *  Lead priority with thresholds (owner 2026-11-19, Fas 2 "front page as a hub"), highest first:
 *    alert > holiday within `holiday.leadWithinDays` (7) > big game / big event within `big.withinDays` (3: a home game of a configured
 *    sport, or an in-town marquee or configured top event; the sooner first) > tonight with at least `minEvents` (3) events > a meeting of
 *    the main organ (`meeting.leadBodies`) > the weekend with at least `minEvents` events > a holiday further out (inside `holiday.daysBefore`)
 *    > guide.
 *  Other meetings and an ordinary game today never lead; they can be secondaries. Tonight and the weekend under `minEvents` are not shown at
 *  all ("1 event" never appears). A secondary is the next-best candidate, at most one per type and never the lead, up to MAX_SECONDARIES.
 *  `guide` is always a candidate (the evergreen pages of config/front-page.ts rotate by day of year), so the page never has an empty state.
 *  All text is a template over data fields (front-page-decks.ts); there is no model text here. */
import type { MeetingView } from './meetings-view';
import type { EveningEntry } from './evening-items';
import { buildEveningSections } from './evening-page';
import { buildWeekendSections } from './evening-weekend';
import { hasEnded, localDayNumber, localHourOf } from './local-day';
import { dateLong, eventsDeck, meetingDeck, plural, weekdayName, type ShowRef } from './front-page-decks';
import type { FrontPageConfig } from '../config/front-page';
import { IN_TOWN_THRESHOLD_MILES } from './ticketmaster';
import { fitDescription } from './meta-description';

export type FrontPageType = 'alert' | 'holiday' | 'game_day' | 'big_event' | 'tonight' | 'meeting' | 'weekend' | 'guide';

/** Highest priority first. */
export const FRONT_PAGE_PRIORITY: FrontPageType[] = ['alert', 'holiday', 'game_day', 'big_event', 'tonight', 'meeting', 'weekend', 'guide'];
/** Lead + 3-4 secondaries (Fas 2). */
export const MAX_SECONDARIES = 4;

export interface FrontPageItem {
  type: FrontPageType;
  headline: string;
  deck: string[];
  url: string;
  image?: { src: string; alt: string; width: number; height: number };
  /** Replaces the type's kicker: a holiday's "Thanksgiving · in 8 days". */
  kicker?: string;
  /** Holiday only: the holiday page this item links to (config/holiday-pages slug), for its photo. */
  pageSlug?: string;
  /** Holiday only: at most MAX_CARD_INSIGHTS lines from the page's data, for the compact card when the holiday is a secondary (Fas 1c).
   *  Empty: no card, the item stays text-only. */
  insights?: string[];
}

export interface FrontPage {
  lead: FrontPageItem;
  secondaries: FrontPageItem[];
  meta_description: string;
}

/** A raw alert as the page loads it; whether it may lead is decided here against `config.alerts`, not by the caller. */
export interface FrontPageAlert {
  headline: string; url: string; until: string | null;
  kind: 'weather' | 'traffic';
  /** weather (NWS): the event name, e.g. "Tornado Warning" */
  event?: string;
  /** weather (Met Office): "yellow" | "amber" | "red" */
  level?: string;
  /** traffic: a full closure of a motorway/arterial, or a fatal crash */
  fullClosure?: boolean; fatal?: boolean;
}
export interface FrontPageHoliday {
  slug: string; label: string; /** local day number (days since epoch) of the holiday */ day: number; url: string; closed?: number | null;
  /** Own visible days (local day numbers, inclusive) instead of the town's holiday window: "Hogmanay and New Year" 27 Dec to the last
   *  bank holiday (owner 2026-11-14). */
  window?: { from: number; to: number };
  /** The days the deck counts down to: it names the first one on or after today ("Hogmanay is Thursday, 31 December."). */
  deckDays?: { label: string; day: number }[];
  /** The page's own insight lines for this season (lib/holiday-view.ts holidayInsights: confirmed rows that change a plan). */
  insights?: string[];
}
export interface FrontPageGame { team: string; opponent: string; startsAt: string; home: boolean; url: string; /** sport key ('football', 'mbb' ...) */ sport?: string }
/** A big in-town event the caller found (an in-town Ticketmaster marquee, a configured top event such as Hobo Day). */
export interface FrontPageBigEvent { title: string; startsAt: string; url: string; venue: string | null }

export interface FrontPageInput {
  cityName: string;
  timezone: string;
  locale: 'en-US' | 'en-GB';
  config: FrontPageConfig;
  alerts: FrontPageAlert[];
  holidays: FrontPageHoliday[];
  evening: EveningEntry[];
  games: FrontPageGame[];
  meetings: MeetingView[];
  bigEvents?: FrontPageBigEvent[];
}

export const WEEKEND_FROM_HOUR = 12;
export const MAX_GUIDES = 2;
/** Insight lines on the compact holiday card (Fas 1c). */
export const MAX_CARD_INSIGHTS = 2;

/** "Thanksgiving · in 8 days" / "· tomorrow" / "· today" / "· 2 days ago". */
export function holidayKicker(label: string, daysAway: number): string {
  const when = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : daysAway > 1 ? `in ${daysAway} days` : daysAway === -1 ? 'yesterday' : `${-daysAway} days ago`;
  return `${label} · ${when}`;
}
const DAY_MS = 86_400_000;

const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1; // 1 = Monday
const timeLabel = (iso: string, tz: string, locale: string) =>
  new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** Friday 12:00 through Sunday 23:59, city time. */
export function inWeekendWindow(now: Date, tz: string): boolean {
  const wd = isoWeekday(localDayNumber(now, tz));
  return wd === 6 || wd === 7 || (wd === 5 && localHourOf(now, tz) >= WEEKEND_FROM_HOUR);
}

/** Why an alert cannot be judged at all (it then never leads, and is logged): the caller must supply `kind`, plus `event` or `level` for weather,
 *  and `fullClosure`/`fatal` for traffic. Null when the alert is well-formed. */
export function alertDefect(a: Partial<FrontPageAlert>): string | null {
  if (a.kind !== 'weather' && a.kind !== 'traffic') return 'missing kind';
  if (a.kind === 'weather') return (a.event ?? '').trim() === '' && (a.level ?? '').trim() === '' ? 'weather alert without event or level' : null;
  return typeof a.fullClosure !== 'boolean' && typeof a.fatal !== 'boolean' ? 'traffic alert without fullClosure or fatal' : null;
}

/** Whether an alert may take the lead slot: it is on the town's allowlist and has not expired. */
export function alertIsSevere(a: FrontPageAlert, rules: FrontPageConfig['alerts'], now: Date): boolean {
  if (a.until != null && new Date(a.until).getTime() <= now.getTime()) return false;
  if (a.kind === 'traffic') return rules.traffic && (a.fullClosure === true || a.fatal === true);
  if (a.level) return rules.metOfficeLevels.includes(a.level.toLowerCase());
  const ev = (a.event ?? '').trim().toLowerCase();
  return ev !== '' && rules.weatherEvents.some((w) => w.toLowerCase() === ev);
}

/** Whether a holiday on local day `holidayDay` may outrank the weekend: close enough, or inside the coming weekend (through the Sunday). */
export function holidayLeads(today: number, holidayDay: number, w: FrontPageConfig['holiday']): boolean {
  if (holidayDay - today <= w.leadWithinDays) return true;
  const sunday = today + (7 - isoWeekday(today));
  return isoWeekday(today) >= 5 && holidayDay <= sunday;
}

/** Day of year (1-366) of the city-time date; picks today's guide. */
export function dayOfYear(now: Date, tz: string): number {
  const today = localDayNumber(now, tz);
  const jan1 = Date.UTC(new Date(today * DAY_MS).getUTCFullYear(), 0, 1) / DAY_MS;
  return today - jan1 + 1;
}

/** Whether a holiday on local day `holidayDay` is on the front page on local day `today`. */
export function holidayVisible(today: number, holidayDay: number, w: FrontPageConfig['holiday']): boolean {
  if (today < holidayDay - w.daysBefore) return false;
  if (today < holidayDay) return true;
  if (today === holidayDay) return w.showOnDay;
  return today <= holidayDay + w.daysAfter;
}

/** Whether a post is on the front page today: its own window when it has one, otherwise the town's holiday window. */
export function postVisible(today: number, h: FrontPageHoliday, w: FrontPageConfig['holiday']): boolean {
  return h.window ? today >= h.window.from && today <= h.window.to : holidayVisible(today, h.day, w);
}

/** The day a post is about today: the first deck day on or after today, else the holiday itself. */
function dayOf(h: FrontPageHoliday, today: number): { label: string; day: number } {
  return h.deckDays?.find((d) => d.day >= today) ?? { label: h.label, day: h.day };
}

const showsOf = (entries: EveningEntry[]): ShowRef[] =>
  entries.map((e) => ({ title: e.title, venue: e.venue, miles: e.distanceMiles }));

/** In the town itself: an own or register row without a distance, or a venue closer than the in-town threshold (lib/ticketmaster.ts). */
export const isInTown = (e: EveningEntry): boolean => e.distanceMiles == null || e.distanceMiles < IN_TOWN_THRESHOLD_MILES;

function alertItem(i: FrontPageInput, now: Date): FrontPageItem | null {
  const live = i.alerts.filter((a) => {
    const defect = alertDefect(a);
    if (defect) { console.warn(`front page: alert skipped (${defect}): ${a?.headline ?? '(no headline)'}`); return false; }
    return alertIsSevere(a, i.config.alerts, now);
  });
  const a = live[0];
  if (!a) return null;
  const until = a.until ? `In effect until ${weekdayName(localDayNumber(new Date(a.until), i.timezone), i.locale)} ${timeLabel(a.until, i.timezone, i.locale)}.` : 'Active now.';
  return { type: 'alert', headline: a.headline, deck: [until], url: a.url };
}

function holidayItem(i: FrontPageInput, today: number): FrontPageItem | null {
  const open = i.holidays
    .filter((h) => postVisible(today, h, i.config.holiday))
    .sort((a, b) => Math.abs(dayOf(a, today).day - today) - Math.abs(dayOf(b, today).day - today) || dayOf(a, today).day - dayOf(b, today).day);
  const h = open[0];
  if (!h) return null;
  const about = dayOf(h, today);
  const verb = about.day < today ? 'was' : 'is';
  const deck = [`${about.label} ${verb} ${weekdayName(about.day, i.locale)}, ${dateLong(about.day, i.locale)}.`];
  const closedLine = h.closed && h.closed > 0 ? `${plural(h.closed, 'place')} in ${i.cityName} ${h.closed === 1 ? 'is' : 'are'} closed.` : null;
  if (closedLine) deck.push(closedLine);
  // Card lines (Fas 1c): the closed count, then the page's own insight rows; none once the day is past.
  const insights = about.day < today ? [] : [...(closedLine ? [closedLine] : []), ...(h.insights ?? [])].slice(0, MAX_CARD_INSIGHTS);
  return {
    type: 'holiday', headline: h.label, deck, url: h.url, kicker: holidayKicker(about.label, about.day - today),
    pageSlug: h.url.replace(/^\/|\/.*$/g, ''), insights,
  };
}

/** "This weekend in {City}" is built from in-town events only; when only regional shows exist the lead says "near {City}" and gives each its
 *  distance (owner 2026-11-07). */
function weekendItem(i: FrontPageInput, now: Date): FrontPageItem | null {
  if (!inWeekendWindow(now, i.timezone)) return null;
  const live = i.evening.filter((e) => !hasEnded({ start: e.start, end: e.end }, now, i.timezone));
  const today = localDayNumber(now, i.timezone);
  const count = (entries: EveningEntry[]) => {
    const sections = buildWeekendSections(entries, now, i.timezone).filter((s) => s.day >= today);
    return { n: sections.reduce((sum, s) => sum + s.count, 0), tops: showsOf(sections.flatMap((s) => s.highlights.slice(0, 1))) };
  };
  const min = i.config.minEvents;
  const inTown = count(live.filter(isInTown));
  if (inTown.n >= min) {
    return { type: 'weekend', headline: `This weekend in ${i.cityName}`, deck: [eventsDeck({ n: inTown.n, city: i.cityName, when: 'this weekend', tops: inTown.tops })], url: '/this-weekend/' };
  }
  const regional = count(live);
  if (regional.n < min) return null;
  return {
    type: 'weekend', headline: `This weekend near ${i.cityName}`, url: '/this-weekend/',
    deck: [eventsDeck({ n: regional.n, city: i.cityName, when: 'this weekend', tops: regional.tops, scope: 'near', unit: i.locale === 'en-GB' ? 'km' : 'miles' })],
  };
}

/** Not over yet (a start up to three hours ago still counts). */
const notOver = (iso: string, now: Date) => new Date(iso).getTime() > now.getTime() - 3 * 3_600_000;

/** A game: `big` = the home game of a configured big sport within `big.withinDays` city-time days (today included); otherwise an ordinary
 *  game today (never a lead). `at` = its start, for ordering against a big event. */
function gameItem(i: FrontPageInput, now: Date, today: number, big: boolean): (FrontPageItem & { at: string }) | null {
  const g = i.games
    .filter((x) => notOver(x.startsAt, now))
    .filter((x) => {
      const d = localDayNumber(new Date(x.startsAt), i.timezone) - today;
      return big ? x.home && !!x.sport && i.config.big.sports.includes(x.sport) && d >= 0 && d <= i.config.big.withinDays : d === 0;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!g) return null;
  const day = localDayNumber(new Date(g.startsAt), i.timezone);
  const when = day === today ? '' : ` ${weekdayName(day, i.locale)}`;
  const where = g.home ? 'at home' : 'away';
  return {
    type: 'game_day', headline: `${g.team} play ${g.opponent}`, url: g.url, at: g.startsAt,
    deck: [`${g.team} play ${g.opponent} ${where}${when} at ${timeLabel(g.startsAt, i.timezone, i.locale)}.`],
    ...(day === today ? {} : { kicker: `Game day · ${weekdayName(day, i.locale)}` }),
  };
}

/** The soonest big in-town event within `big.withinDays` days that has not ended. */
function bigEventItem(i: FrontPageInput, now: Date, today: number): (FrontPageItem & { at: string }) | null {
  const e = (i.bigEvents ?? [])
    .filter((x) => notOver(x.startsAt, now))
    .filter((x) => { const d = localDayNumber(new Date(x.startsAt), i.timezone) - today; return d >= 0 && d <= i.config.big.withinDays; })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!e) return null;
  const day = localDayNumber(new Date(e.startsAt), i.timezone);
  const when = day === today ? 'today' : weekdayName(day, i.locale);
  return {
    type: 'big_event', headline: e.title, url: e.url, at: e.startsAt, kicker: day === today ? 'Today' : weekdayName(day, i.locale),
    deck: [`${e.title}${e.venue ? ` at ${e.venue}` : ''}, ${when} at ${timeLabel(e.startsAt, i.timezone, i.locale)}.`],
  };
}

/** The next meeting within `meeting.withinDays`; `main`: only the main organ (`meeting.leadBodies`), otherwise only the other organs. */
function meetingItem(i: FrontPageInput, today: number, main: boolean): FrontPageItem | null {
  const ymdDay = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
  const m = i.meetings
    .filter((x) => !x.quorumNotice && !x.cancelled && !x.postponed && !x.closed && !x.collapsedGroup)
    .filter((x) => x.items.length > 0)
    .filter((x) => i.config.meeting.leadBodies.includes(x.bodyKey) === main)
    .filter((x) => { const d = ymdDay(x.ymd) - today; return d >= 0 && d <= i.config.meeting.withinDays; })
    .sort((a, b) => a.ymd.localeCompare(b.ymd) || (a.startMs ?? 0) - (b.startMs ?? 0))[0];
  if (!m) return null;
  const weekday = weekdayName(ymdDay(m.ymd), i.locale);
  return {
    type: 'meeting', headline: `${m.bodyLabel} meets ${weekday}`,
    deck: [meetingDeck({ body: m.bodyLabel, weekday, time: m.time, items: m.items })],
    url: `/city-hall/#meeting-${m.id}`,
  };
}

function tonightItem(i: FrontPageInput, now: Date): FrontPageItem | null {
  if (inWeekendWindow(now, i.timezone)) return null;
  const live = i.evening.filter((e) => !hasEnded({ start: e.start, end: e.end }, now, i.timezone));
  const inTown = buildEveningSections(live.filter(isInTown), now, i.timezone)[0];
  const min = i.config.minEvents;
  if (inTown && inTown.count >= min) {
    return { type: 'tonight', headline: `Tonight in ${i.cityName}`, deck: [eventsDeck({ n: inTown.count, city: i.cityName, when: 'tonight', tops: showsOf(inTown.highlights) })], url: '/tonight/' };
  }
  const regional = buildEveningSections(live, now, i.timezone)[0];
  if (!regional || regional.count < min) return null;
  return {
    type: 'tonight', headline: `Tonight near ${i.cityName}`, url: '/tonight/',
    deck: [eventsDeck({ n: regional.count, city: i.cityName, when: 'tonight', tops: showsOf(regional.highlights), scope: 'near', unit: i.locale === 'en-GB' ? 'km' : 'miles' })],
  };
}

/** The evergreen guides, today's first: rotated by day of year so the fallback changes daily. */
export function guideItems(i: Pick<FrontPageInput, 'config' | 'timezone'>, now: Date): FrontPageItem[] {
  const gs = i.config.guides;
  if (gs.length === 0) return [];
  const start = dayOfYear(now, i.timezone) % gs.length;
  return gs.map((_, k) => gs[(start + k) % gs.length]).map((g) => ({ type: 'guide' as const, headline: g.title, deck: [g.deck], url: g.url }));
}

/** Build a meta description from the lead's first deck sentence, through the same fitDescription() as every page (whole sentences,
 *  at most 160 characters; 2026-11-11: Glasgow's read "...including Automatic"). */
export function metaDescriptionOf(lead: FrontPageItem): string {
  return fitDescription(lead.deck[0] ?? lead.headline);
}

export function selectFrontPage(i: FrontPageInput, now: Date): FrontPage {
  const today = localDayNumber(now, i.timezone);
  const holiday = holidayItem(i, today);
  const nearest = i.holidays.filter((h) => postVisible(today, h, i.config.holiday))
    .map((h) => dayOf(h, today).day - today).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  const holidayNear = !!holiday && nearest !== undefined && nearest <= i.config.holiday.leadWithinDays;
  const bigGame = gameItem(i, now, today, true);
  const bigs = [bigGame, bigEventItem(i, now, today)].filter((x): x is FrontPageItem & { at: string } => !!x).sort((a, b) => a.at.localeCompare(b.at));
  const strip = ({ at: _at, ...it }: FrontPageItem & { at?: string }): FrontPageItem => it;
  const guides = guideItems(i, now);
  // Natural order; `lead: false` = may be a secondary, never the lead (owner 2026-11-19: other meetings, an ordinary game today).
  const ranked: { it: FrontPageItem | null; lead: boolean }[] = [
    { it: alertItem(i, now), lead: true },
    { it: holidayNear ? holiday : null, lead: true },
    ...bigs.map((it) => ({ it: strip(it), lead: true })),
    { it: tonightItem(i, now), lead: true },
    { it: meetingItem(i, today, true), lead: true },
    { it: bigGame ? null : (() => { const g = gameItem(i, now, today, false); return g ? strip(g) : null; })(), lead: false },
    { it: meetingItem(i, today, false), lead: false },
    { it: weekendItem(i, now), lead: true },
    { it: holidayNear ? null : holiday, lead: true },
    ...guides.slice(0, 1).map((it) => ({ it, lead: true })),
  ];
  const cands = ranked.filter((r): r is { it: FrontPageItem; lead: boolean } => !!r.it);
  const leadIdx = cands.findIndex((r) => r.lead);
  if (leadIdx < 0) throw new Error(`front page: no candidate for ${i.cityName}; config/front-page.ts needs at least one guide`);
  const lead = cands[leadIdx].it;
  // At most MAX_GUIDES guide items on the page, the lead included; one item per type.
  let guideCount = lead.type === 'guide' ? 1 : 0;
  const types = new Set<FrontPageType>([lead.type]);
  const secondaries: FrontPageItem[] = [];
  for (const { it } of cands.filter((_, k) => k !== leadIdx)) {
    if (secondaries.length >= MAX_SECONDARIES) break;
    if (it.type !== 'guide' && types.has(it.type)) continue;
    if (it.type === 'guide') { if (guideCount >= MAX_GUIDES) continue; guideCount++; }
    types.add(it.type);
    secondaries.push(it);
  }
  // Fewer than three secondaries: top up with further guides (distinct pages), within the guide cap.
  for (const g of guides.slice(1)) {
    if (secondaries.length >= 3 || guideCount >= MAX_GUIDES) break;
    if (g.url !== lead.url && !secondaries.some((x) => x.url === g.url)) { secondaries.push(g); guideCount++; }
  }
  return { lead, secondaries, meta_description: metaDescriptionOf(lead) };
}
