/** Structured view of the `meetings` table for the /city-hall/ page: organ normalisation, de-duplication,
 *  agenda-item cleanup, topic labels, start instants, .ics and Event JSON-LD. Pure functions only (no DB, no
 *  Astro) so every rule is unit-tested against real titles; db.ts only fetches rows.
 *
 *  Only facts from the source go out: organ, date, time, place, agenda item titles verbatim, links. No
 *  generated prose. Written against Brookings (Legistar for the city + the county's AgendaCenter); the
 *  per-town table at the bottom is what enables another town. */
import { escapeIcsText, foldIcsLine, toIcsUtc } from './ics';

export interface MeetingRow {
  id: number;
  body: string | null;
  meeting_date: string | Date;
  agenda_url: string | null;
  minutes_url: string | null;
  raw_data: Record<string, any> | null;
  /** slug of the plain-language story for this meeting, when one exists. */
  story_slug?: string | null;
}

export type Tone = 'council' | 'planning' | 'utilities' | 'school' | 'other';
export interface BodyInfo { key: string; label: string; tone: Tone }

/** Every organ name Brookings' two sources use (checked against all 134 stored rows, 2026-11-05).
 *  Exact match on the source's own string; an organ not listed falls back to its own name and tone 'other',
 *  so a new body shows up rather than vanishing. Different organs are never merged: the county's "Planning &
 *  Zoning Commission" is not the city's "Planning Commission". */
const BODIES: Record<string, BodyInfo> = {
  'City Council': { key: 'city-council', label: 'City Council', tone: 'council' },
  'Commission': { key: 'county-commission', label: 'County Commission', tone: 'council' },
  'Planning Commission': { key: 'planning-commission', label: 'Planning Commission', tone: 'planning' },
  'Planning & Zoning Commission': { key: 'county-planning-zoning', label: 'County Planning & Zoning Commission', tone: 'planning' },
  'Joint Board of Adjustment': { key: 'joint-board-of-adjustment', label: 'Joint Board of Adjustment', tone: 'planning' },
  'Brookings County/City of Brookings Joint Board of Adjustment': { key: 'joint-board-of-adjustment', label: 'Joint Board of Adjustment', tone: 'planning' },
  'Brookings Historic Preservation Commission': { key: 'historic-preservation', label: 'Historic Preservation Commission', tone: 'planning' },
  'Utility Board': { key: 'utility-board', label: 'Utility Board', tone: 'utilities' },
  'Airport Board': { key: 'airport-board', label: 'Airport Board', tone: 'other' },
  'Brookings Disability Awareness Committee': { key: 'disability-awareness', label: 'Disability Awareness Committee', tone: 'other' },
  'Brookings Health System Board of Trustees': { key: 'health-system-board', label: 'Health System Board of Trustees', tone: 'other' },
  'Brookings Public Arts Commission': { key: 'public-arts', label: 'Public Arts Commission', tone: 'other' },
  'Dacotah Bank Center Advisory Board': { key: 'dacotah-bank-center', label: 'Dacotah Bank Center Advisory Board', tone: 'other' },
  'East Central Communications Council (E-911)': { key: 'e911', label: 'East Central Communications Council (E-911)', tone: 'other' },
  'Human Rights Commission': { key: 'human-rights', label: 'Human Rights Commission', tone: 'other' },
  'Library Board': { key: 'library-board', label: 'Library Board', tone: 'other' },
  'Park & Recreation Advisory Board': { key: 'park-rec-board', label: 'Park & Recreation Advisory Board', tone: 'other' },
  'Sustainability Council': { key: 'sustainability-council', label: 'Sustainability Council', tone: 'other' },
};

export function normalizeBody(raw: string | null | undefined): BodyInfo {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  const hit = BODIES[name];
  if (hit) return hit;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
  return { key, label: name || 'Meeting', tone: /school/i.test(name) ? 'school' : 'other' };
}

/* ------------------------------------------------------------------ time */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The UTC offset in minutes of `tz` at the instant `ms`. */
function tzOffsetMinutes(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Wall-clock time in `tz` -> the real instant (ms). Two passes so the guess lands on the right side of a DST change. */
export function zonedToInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let ms = wall - tzOffsetMinutes(wall, tz) * 60000;
  ms = wall - tzOffsetMinutes(ms, tz) * 60000;
  return ms;
}

/** "5:30 PM" -> [17, 30]; anything else -> null (never guessed). */
export function parseClock(text: string | null | undefined): [number, number] | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP])\.?M\.?\s*$/i.exec(text ?? '');
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  const min = Number(m[2]);
  return min < 60 ? [h, min] : null;
}

export interface MeetingWhen {
  ymd: string;
  /** "5:30 PM", or null when the source gives no time. */
  time: string | null;
  /** The real instant, only when there is a time. */
  startMs: number | null;
}

/** Legistar stores a bare calendar date at UTC midnight and the clock as a separate string; towns whose source
 *  carries a real instant (siteConfig.meetingsHaveTime) are read in the town's zone instead. */
export function meetingWhen(row: MeetingRow, tz: string, hasTime: boolean): MeetingWhen {
  const d = new Date(row.meeting_date);
  if (hasTime) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const t = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
    return { ymd: p, time: t, startMs: d.getTime() };
  }
  const ymd = d.toISOString().slice(0, 10);
  const clock = parseClock(row.raw_data?.EventTime);
  if (!clock) return { ymd, time: null, startMs: null };
  const [y, m, day] = ymd.split('-').map(Number);
  const time = `${clock[0] % 12 || 12}:${String(clock[1]).padStart(2, '0')} ${clock[0] >= 12 ? 'PM' : 'AM'}`;
  return { ymd, time, startMs: zonedToInstant(y, m, day, clock[0], clock[1], tz) };
}

/** "Tue, Nov 10" from a YYYY-MM-DD, no timezone maths. */
export function formatYmd(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

/** Whole calendar days from `todayYmd` to `ymd`. */
export function daysBetween(todayYmd: string, ymd: string): number {
  const a = todayYmd.split('-').map(Number);
  const b = ymd.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/* ----------------------------------------------------------------- items */

/** Agenda lines that carry no information about what is decided. Anchored at the start of the title. */
const PROCEDURAL = new RegExp(
  '^(call(ing)? (the meeting )?to order|roll call|(the )?pledge of allegiance|invocation|land acknowledg\\w*|' +
  '(approv\\w*|adoption) of [^.]{0,40}\\b(agenda|minutes)\\b|consent (agenda|calendar)$|' +
  'minutes( of|$)|adjourn\\w*|open forum|public (comment|forum|input)|notice of quorum|' +
  'it is possible that|items? to be (added|placed)|invitation for citizens?|determination of (a )?quorum|' +
  'the city of brookings is committed|record of .{0,60}attendance|break\\b|announcements?|motions? to excuse|executive session$|other business$|documents:?$)', 'i',
);

export const MAX_ITEM_TITLE = 200;

/** A line that opens with a known organ name and a colon is a roster ("Brookings City Council: <member names>",
 *  "Brookings City Council Staff: ..."), not a thing to be decided. Built from BODIES (names and labels, with or without
 *  "Brookings"), anchored at the start, so a title that only mentions an organ further in stays. */
const ROSTER = (() => {
  const names = new Set<string>();
  for (const [raw, b] of Object.entries(BODIES)) for (const n of [raw, b.label]) { names.add(n); names.add(n.replace(/^Brookings\s+/i, '')); }
  const escape = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = [...names].map(escape).sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`^(brookings\\s+)?(${alt})(\\s+staff)?\\s*:`, 'i');
})();

/** Titles worth showing: not procedural, 3-200 characters. Verbatim apart from collapsed whitespace and a number prefix. */
export function substantiveItems(titles: string[]): string[] {
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.replace(/\s+/g, ' ').replace(/^\d+\.+\s*/, '').trim();
    if (t.length < 3 || t.length > MAX_ITEM_TITLE) continue;
    if (PROCEDURAL.test(t) || ROSTER.test(t)) continue;
    out.push(t);
  }
  return out;
}

/** Top-level numbered lines ("1." alone on a line, title on the next) from a county AgendaCenter text. */
export function itemsFromAgendaText(text: string | null | undefined): string[] {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\.$/.test(lines[i])) {
      const next = lines.slice(i + 1).find((l) => l !== '');
      if (next && !/^\d+\.$/.test(next)) out.push(next);
    }
  }
  return out;
}

/** The agenda titles of a row, in agenda order, from the structured list when there is one, else the text. */
export function rawAgendaTitles(raw: Record<string, any> | null): string[] {
  const items = raw?.agenda_items;
  if (Array.isArray(items) && items.length > 0) {
    return items.map((i: any) => String(i?.EventItemTitle ?? i?.title ?? '')).filter((t) => t !== '');
  }
  return itemsFromAgendaText(raw?.agenda_text);
}

/* ---------------------------------------------------------------- topics */

/** Topic labels at meeting level, from the substantive agenda titles. Conservative on purpose: a miss is fine, a wrong
 *  label is not. Parks, public safety and personnel are deliberately absent (tested false positives, see the tests).
 *  A bare street/road/avenue is not enough ("127 Causewayside Street" is an address); a street needs a works word. */
export const TOPIC_RULES: { label: string; test: RegExp }[] = [
  { label: 'Budget', test: /\b(budget|appropriations?|levy|fee schedule|financial report)\b/i },
  { label: 'Zoning & land use', test: /\b(rezon\w*|zoning|conditional use|variance|plat|subdivision|annex\w*|site (development )?plan|comprehensive plan|land use)\b/i },
  {
    label: 'Streets & traffic',
    test: /\b(sidewalks?|bridges?|traffic|intersections?|paving|pavement|resurfacing|crosswalks?|right-of-way|highway|roundabouts?|alley|street (light(ing|s)?|closures?|vacation)|road closures?|(street|road|avenue)s? (improvements?|reconstruction|project|maintenance|repair|construction|department))\b/i,
  },
  { label: 'Utilities', test: /\b(water|sewer|wastewater|stormwater|electric|utility|utilities|landfill|solid waste|broadband)\b/i },
  { label: 'Licenses & permits', test: /\b(licen[sc]es?|permits?)\b/i },
];

export function topicsFor(titles: string[]): string[] {
  return TOPIC_RULES.filter((r) => titles.some((t) => r.test.test(t))).map((r) => r.label);
}

/* ------------------------------------------------------------ the view */

export interface MeetingView {
  id: number;
  source: 'legistar' | 'county';
  bodyKey: string;
  bodyLabel: string;
  tone: Tone;
  ymd: string;
  time: string | null;
  startMs: number | null;
  location: string | null;
  agendaUrl: string | null;
  minutesUrl: string | null;
  videoUrl: string | null;
  detailUrl: string | null;
  storySlug: string | null;
  /** substantive agenda titles, verbatim */
  items: string[];
  topics: string[];
  /** set when this card stands for a joint meeting with another organ */
  jointWith: string | null;
}

/** A Legistar "Notice of Quorum" is an off-site notice, not a meeting residents can attend to speak at. */
export function isQuorumNoticeOnly(raw: Record<string, any> | null): boolean {
  const t = String(raw?.agenda_text ?? '');
  return /notice of quorum/i.test(t) && /no official city business/i.test(t);
}

const isLegistar = (r: MeetingRow) => r.raw_data != null && 'EventId' in r.raw_data;
const isJoint = (r: MeetingRow) => /joint meeting/i.test(String(r.raw_data?.agenda_text ?? '').slice(0, 600)) || /\bjoint\b/i.test(r.body ?? '');

function cleanLocation(raw: unknown): string | null {
  const s = String(raw ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ');
  return s || null;
}

function toView(r: MeetingRow, tz: string, hasTime: boolean): MeetingView {
  const leg = isLegistar(r);
  const raw = r.raw_data ?? {};
  const b = normalizeBody(leg ? (raw.EventBodyName ?? r.body) : r.body);
  const when = meetingWhen(r, tz, hasTime);
  return {
    id: r.id,
    source: leg ? 'legistar' : 'county',
    bodyKey: b.key, bodyLabel: b.label, tone: b.tone,
    ymd: when.ymd, time: when.time, startMs: when.startMs,
    location: leg ? cleanLocation(raw.EventLocation) : null,
    agendaUrl: r.agenda_url || (leg ? raw.EventAgendaFile ?? null : null),
    minutesUrl: r.minutes_url || (leg ? raw.EventMinutesFile ?? null : null),
    videoUrl: leg ? raw.EventVideoPath ?? null : null,
    detailUrl: leg ? raw.EventInSiteURL ?? null : null,
    storySlug: r.story_slug ?? null,
    items: substantiveItems(rawAgendaTitles(r.raw_data)),
    topics: [],
    jointWith: null,
  };
}

export interface DedupeNote { dropped: number; kept: number; why: string }

/** Rows -> one view per real meeting, oldest first.
 *  1. Notice-of-quorum rows are not meetings.
 *  2. Same date + same normalised organ: keep the Legistar row (the city's own system). Fields the kept row lacks
 *     (agenda link, agenda items, story) are filled from the dropped one; time, place and organ stay Legistar's.
 *  3. Different organs are never merged, except a city and a county row on the same day that both say "joint
 *     meeting": the Legistar row stays and is marked joint. */
export function buildMeetings(rows: MeetingRow[], tz: string, hasTime: boolean, notes?: DedupeNote[]): MeetingView[] {
  const real = rows.filter((r) => !isQuorumNoticeOnly(r.raw_data));
  const views = real.map((r) => ({ row: r, v: toView(r, tz, hasTime) }));
  const dropped = new Set<number>();
  const byKey = new Map<string, typeof views>();
  for (const x of views) {
    const k = `${x.v.ymd}|${x.v.bodyKey}`;
    byKey.set(k, [...(byKey.get(k) ?? []), x]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(b.v.source === 'legistar') - Number(a.v.source === 'legistar') || a.v.id - b.v.id);
    const [keep, ...rest] = group;
    for (const d of rest) {
      keep.v.agendaUrl ??= d.v.agendaUrl;
      keep.v.minutesUrl ??= d.v.minutesUrl;
      keep.v.storySlug ??= d.v.storySlug;
      if (keep.v.items.length === 0) keep.v.items = d.v.items;
      dropped.add(d.v.id);
    }
    notes?.push({ dropped: rest.length, kept: keep.v.id, why: `same date + organ (${keep.v.ymd} ${keep.v.bodyLabel})` });
  }
  const live = views.filter((x) => !dropped.has(x.v.id));
  for (const a of live) {
    if (a.v.source !== 'legistar' || a.v.bodyKey !== 'city-council' || !isJoint(a.row)) continue;
    const other = live.find((b) => b.v.source === 'county' && b.v.bodyKey === 'county-commission' && b.v.ymd === a.v.ymd && isJoint(b.row));
    if (!other) continue;
    a.v.jointWith = other.v.bodyLabel;
    a.v.agendaUrl ??= other.v.agendaUrl;
    a.v.storySlug ??= other.v.storySlug;
    if (a.v.items.length === 0) a.v.items = other.v.items;
    dropped.add(other.v.id);
    notes?.push({ dropped: 1, kept: a.v.id, why: `joint meeting ${a.v.ymd}: City Council + ${other.v.bodyLabel}` });
  }
  const out = live.filter((x) => !dropped.has(x.v.id)).map((x) => x.v);
  for (const v of out) v.topics = topicsFor(v.items);
  return out.sort((a, b) => (a.startMs ?? Date.parse(a.ymd)) - (b.startMs ?? Date.parse(b.ymd)) || a.id - b.id);
}

/** Meetings still ahead: a dated meeting stays "upcoming" through its own day; a timed one for 3 h after it starts. */
export function isUpcoming(m: MeetingView, nowMs: number, todayYmd: string): boolean {
  return m.startMs != null ? m.startMs + 3 * 3_600_000 >= nowMs : m.ymd >= todayYmd;
}

/** Organs that actually have a meeting in the list, in order of first appearance (filter chips). */
export function organChips(ms: MeetingView[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const m of ms) if (!seen.has(m.bodyKey)) seen.set(m.bodyKey, m.bodyLabel);
  return [...seen].map(([key, label]) => ({ key, label }));
}

/* ------------------------------------------------------------- ics, ld */

/** Meetings that can go in a calendar: a real start instant and a place. */
export const canCalendar = (m: MeetingView): boolean => m.startMs != null && !!m.location;

export function buildMeetingIcs(m: MeetingView, site: { siteName: string; domain: string }, pageUrl: string): string | null {
  if (!canCalendar(m)) return null;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${site.siteName}//Meetings//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:meeting-${m.id}@${site.domain}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(new Date(m.startMs!).toISOString())}`,
    `SUMMARY:${escapeIcsText(`${m.bodyLabel} meeting`)}`,
    `LOCATION:${escapeIcsText(m.location!)}`,
    ...(m.agendaUrl ? [`DESCRIPTION:${escapeIcsText(`Agenda: ${m.agendaUrl}`)}`] : []),
    `URL:${pageUrl}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function isoWithOffset(ms: number, tz: string): string {
  const off = tzOffsetMinutes(ms, tz);
  const local = new Date(ms + off * 60000).toISOString().slice(0, 19);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Event JSON-LD for an upcoming meeting; null unless it has a real start and a place, and comes from the city's own system. */
export function buildMeetingJsonLd(
  m: MeetingView, tz: string, place: { locality: string; region: string; country: string }, organizer: string, pageUrl: string,
): Record<string, unknown> | null {
  if (m.source !== 'legistar' || !canCalendar(m)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${m.bodyLabel} meeting`,
    startDate: isoWithOffset(m.startMs!, tz),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: m.location,
      address: { '@type': 'PostalAddress', addressLocality: place.locality, addressRegion: place.region, addressCountry: place.country },
    },
    organizer: { '@type': 'Organization', name: organizer },
    url: pageUrl,
  };
}

/* ------------------------------------------------------------ per town */

export interface MeetingsTownConfig {
  /** Which organs the how-to-comment guide covers, and where it lives. */
  comment: { href: string; bodyKeys: string[] } | null;
  place: { locality: string; region: string; country: string };
  organizer: string;
}

/** A town is on the new meetings page only when it has an entry here. */
export const MEETINGS_TOWNS: Record<string, MeetingsTownConfig> = {
  brookings_sd: {
    comment: { href: '/how-city-council-works/', bodyKeys: ['city-council'] },
    place: { locality: 'Brookings', region: 'SD', country: 'US' },
    organizer: 'City of Brookings',
  },
};

/** Meta description that leads with the next meeting ("Next: City Council, Tue, Nov 10, 5:30 PM. ..."), kept inside the site's
 *  155-character limit; null when it would not fit, so the caller keeps the standard description. */
export function nextMeetingDescription(m: MeetingView, cityName: string): string | null {
  const when = `${formatYmd(m.ymd)}${m.time ? `, ${m.time}` : ''}`;
  const text = `Next: ${m.bodyLabel}, ${when}. Agendas for ${cityName} council, commission and committee meetings, and how to follow or speak.`;
  return text.length <= 155 ? text : null;
}

/** Meetings per archive page (towns on the structured layout only). */
export const ARCHIVE_PAGE_SIZE = 25;
