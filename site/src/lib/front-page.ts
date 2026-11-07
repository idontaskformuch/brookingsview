/** The daily front page's lead slot: one lead and 2-3 secondaries, chosen by rule from what the site already holds. Pure: `selectFrontPage(input, now)`
 *  takes the town's settings and its data, and every date and time is worked out in the town's own timezone (local-day.ts), never the build
 *  machine's or the visitor's.
 *
 *  Priority, highest first: alert, holiday, weekend, game_day, meeting, tonight, guide. A holiday that is more than `leadWithinDays` away (and not
 *  inside the coming weekend) drops below the weekend, so it is secondary while the weekend window is open. A secondary is the next-best candidate, at most one per
 *  type and never the lead. `guide` is always a candidate (the evergreen pages of config/front-page.ts rotate by day of year), so the page
 *  never has an empty state. All text is a template over data fields (front-page-decks.ts); there is no model text here. */
import type { MeetingView } from './meetings-view';
import type { EveningEntry } from './evening-items';
import { buildEveningSections } from './evening-page';
import { buildWeekendSections } from './evening-weekend';
import { hasEnded, localDayNumber, localHourOf } from './local-day';
import { dateLong, eventsDeck, meetingDeck, plural, weekdayName, type ShowRef } from './front-page-decks';
import type { FrontPageConfig } from '../config/front-page';

export type FrontPageType = 'alert' | 'holiday' | 'weekend' | 'game_day' | 'meeting' | 'tonight' | 'guide';

/** Highest priority first. */
export const FRONT_PAGE_PRIORITY: FrontPageType[] = ['alert', 'holiday', 'weekend', 'game_day', 'meeting', 'tonight', 'guide'];

export interface FrontPageItem {
  type: FrontPageType;
  headline: string;
  deck: string[];
  url: string;
  image?: { src: string; alt: string; width: number; height: number };
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
export interface FrontPageHoliday { slug: string; label: string; /** local day number (days since epoch) of the holiday */ day: number; url: string; closed?: number | null }
export interface FrontPageGame { team: string; opponent: string; startsAt: string; home: boolean; url: string }

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
}

export const META_DESCRIPTION_MAX = 155;
export const WEEKEND_FROM_HOUR = 12;
export const MAX_GUIDES = 2;
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

const showsOf = (entries: EveningEntry[]): ShowRef[] =>
  entries.map((e) => ({ title: e.title, venue: e.venue }));

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
    .filter((h) => holidayVisible(today, h.day, i.config.holiday))
    .sort((a, b) => Math.abs(a.day - today) - Math.abs(b.day - today) || a.day - b.day);
  const h = open[0];
  if (!h) return null;
  const verb = h.day < today ? 'was' : 'is';
  const deck = [`${h.label} ${verb} ${weekdayName(h.day, i.locale)}, ${dateLong(h.day, i.locale)}.`];
  if (h.closed && h.closed > 0) deck.push(`${plural(h.closed, 'place')} in ${i.cityName} ${h.closed === 1 ? 'is' : 'are'} closed.`);
  return { type: 'holiday', headline: h.label, deck, url: h.url };
}

function weekendItem(i: FrontPageInput, now: Date): FrontPageItem | null {
  if (!inWeekendWindow(now, i.timezone)) return null;
  const live = i.evening.filter((e) => !hasEnded({ start: e.start, end: e.end }, now, i.timezone));
  const sections = buildWeekendSections(live, now, i.timezone).filter((s) => s.day >= localDayNumber(now, i.timezone));
  const n = sections.reduce((sum, s) => sum + s.count, 0);
  if (n === 0) return null;
  const tops = showsOf(sections.flatMap((s) => s.highlights.slice(0, 1)));
  return { type: 'weekend', headline: `This weekend in ${i.cityName}`, deck: [eventsDeck({ n, city: i.cityName, when: 'this weekend', tops })], url: '/this-weekend/' };
}

function gameItem(i: FrontPageInput, now: Date, today: number): FrontPageItem | null {
  const g = i.games
    .filter((x) => localDayNumber(new Date(x.startsAt), i.timezone) === today && new Date(x.startsAt).getTime() > now.getTime() - 3 * 3_600_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!g) return null;
  const where = g.home ? 'at home' : 'away';
  return { type: 'game_day', headline: `${g.team} play ${g.opponent}`, deck: [`${g.team} play ${g.opponent} ${where} at ${timeLabel(g.startsAt, i.timezone, i.locale)}.`], url: g.url };
}

function meetingItem(i: FrontPageInput, today: number): FrontPageItem | null {
  const ymdDay = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
  const m = i.meetings
    .filter((x) => !x.quorumNotice && !x.cancelled && !x.postponed && !x.closed && !x.collapsedGroup)
    .filter((x) => x.items.length > 0)
    .filter((x) => { const d = ymdDay(x.ymd) - today; return d >= 0 && d <= i.config.meetingWithinDays; })
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
  const tonight = buildEveningSections(live, now, i.timezone)[0];
  if (!tonight || tonight.count === 0) return null;
  return { type: 'tonight', headline: `Tonight in ${i.cityName}`, deck: [eventsDeck({ n: tonight.count, city: i.cityName, when: 'tonight', tops: showsOf(tonight.highlights) })], url: '/tonight/' };
}

/** The evergreen guides, today's first: rotated by day of year so the fallback changes daily. */
export function guideItems(i: Pick<FrontPageInput, 'config' | 'timezone'>, now: Date): FrontPageItem[] {
  const gs = i.config.guides;
  if (gs.length === 0) return [];
  const start = dayOfYear(now, i.timezone) % gs.length;
  return gs.map((_, k) => gs[(start + k) % gs.length]).map((g) => ({ type: 'guide' as const, headline: g.title, deck: [g.deck], url: g.url }));
}

/** Build a meta description from the lead's first deck sentence: at most 155 characters, cut at a sentence or word boundary. */
export function metaDescriptionOf(lead: FrontPageItem): string {
  const s = (lead.deck[0] ?? lead.headline).replace(/\s+/g, ' ').trim();
  if (s.length <= META_DESCRIPTION_MAX) return s;
  const cut = s.slice(0, META_DESCRIPTION_MAX + 1);
  const at = cut.lastIndexOf(' ');
  return (at > 0 ? cut.slice(0, at) : s.slice(0, META_DESCRIPTION_MAX)).replace(/[\s,;:\-–—]+$/, '');
}

export function selectFrontPage(i: FrontPageInput, now: Date): FrontPage {
  const today = localDayNumber(now, i.timezone);
  const byType: Partial<Record<FrontPageType, FrontPageItem>> = {};
  const set = (it: FrontPageItem | null) => { if (it) byType[it.type] = it; };
  set(alertItem(i, now));
  set(holidayItem(i, today));
  set(weekendItem(i, now));
  set(gameItem(i, now, today));
  set(meetingItem(i, today));
  set(tonightItem(i, now));
  const guides = guideItems(i, now);
  if (guides[0]) byType.guide = guides[0];

  const order = [...FRONT_PAGE_PRIORITY];
  const hol = i.holidays.filter((h) => holidayVisible(today, h.day, i.config.holiday));
  if (byType.holiday && byType.weekend && !hol.some((h) => holidayLeads(today, h.day, i.config.holiday))) {
    order.splice(order.indexOf('holiday'), 1);
    order.splice(order.indexOf('weekend') + 1, 0, 'holiday');
  }
  const ranked = order.map((t) => byType[t]).filter((x): x is FrontPageItem => !!x);
  if (ranked.length === 0) throw new Error(`front page: no candidate for ${i.cityName}; config/front-page.ts needs at least one guide`);
  const [lead, ...rest] = ranked;
  // At most MAX_GUIDES guide items on the page, the lead included.
  let guideCount = lead.type === 'guide' ? 1 : 0;
  const secondaries: FrontPageItem[] = [];
  for (const it of rest) {
    if (secondaries.length >= 3) break;
    if (it.type === 'guide') { if (guideCount >= MAX_GUIDES) continue; guideCount++; }
    secondaries.push(it);
  }
  // Fewer than two secondaries: top up with further guides (distinct pages), within the guide cap.
  for (const g of guides.slice(1)) {
    if (secondaries.length >= 2 || guideCount >= MAX_GUIDES) break;
    if (g.url !== lead.url && !secondaries.some((s) => s.url === g.url)) { secondaries.push(g); guideCount++; }
  }
  return { lead, secondaries, meta_description: metaDescriptionOf(lead) };
}
