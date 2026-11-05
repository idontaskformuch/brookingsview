/** Structured view of the `meetings` table for the /city-hall/ page: organ normalisation, de-duplication,
 *  agenda-item cleanup, topic labels, start instants, .ics and Event JSON-LD. Pure functions only (no DB, no
 *  Astro) so every rule is unit-tested against real titles; db.ts only fetches rows.
 *
 *  Only facts from the source go out: organ, date, time, place, agenda item titles verbatim, links. No
 *  generated prose. Written against Brookings (Legistar for the city + the county's AgendaCenter); the
 *  per-town table at the bottom is what enables another town. */
import { escapeIcsText, foldIcsLine, toIcsUtc } from './ics';
import { isSandboxUrl } from './sandbox-url';
import { ukTitleHeld } from './uk-title-guard.gb';
import { MEETINGS_TOWNS } from '../config/meetings';

export { MEETINGS_TOWNS };

export interface MeetingRow {
  id: number;
  body: string | null;
  meeting_date: string | Date;
  agenda_url: string | null;
  minutes_url: string | null;
  raw_data: Record<string, any> | null;
  /** slug of the plain-language story for this meeting, when one exists. */
  story_slug?: string | null;
  /** when the scraper first stored the row (ISO); the RSS feed's "new" */
  created_at?: string | Date | null;
}

export type Tone = 'council' | 'planning' | 'utilities' | 'school' | 'other';
export interface BodyInfo {
  key: string;
  label: string;
  tone: Tone;
  /** a source that names the kind of meeting, not the organ (AgendaLink, eSCRIBE): "Regular", "Study session" ... */
  type?: string;
  /** closed to the public: no agenda is expected and none is promised */
  closed?: boolean;
  /** the chip / collapsible group this organ belongs to (Glasgow); organs without one chip under their own label */
  group?: string;
}

export interface MeetingsTownConfig {
  /** Exact source string -> organ. See config/meetings.ts. */
  bodies: Record<string, BodyInfo>;
  /** Source strings that are never shown (personnel matters). */
  hidden: string[];
  /** Organs matched by rule instead of by listing every one (Glasgow's Area Partnerships). */
  groupRules: { test: RegExp; group: string; tone: Tone }[];
  /** Groups shown folded under a "N meetings" summary instead of among the main list. */
  collapsedGroups: string[];
  topicLabels: boolean;
  /** 'us': "Tue, Nov 10", "6:00 PM". 'gb': "Tue 10 Nov", "18:00". */
  locale: 'us' | 'gb';
  /** Which organs the how-to-comment guide covers, and where it lives. */
  comment: { href: string; bodyKeys: string[] } | null;
  place: { locality: string; region: string; country: string };
  /** the public body that holds the meetings (Event JSON-LD organizer) */
  authority: string;
  /** The town's own public page for agendas. Linked when a meeting has no agenda link of its own. */
  portal: { href: string; label: string } | null;
  /** Plain links under "About this page" that only this town has a page for. */
  extraLinks: { lead: string; href: string; label: string }[];
  /** A sentence added to the empty state ("Moreno Valley usually posts agendas 4–7 days ahead.") */
  emptyNote: string | null;
}

const DEFAULT_CONFIG: MeetingsTownConfig = MEETINGS_TOWNS.brookings_sd;
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Organ for a source string: listed -> as listed; Area-Partnership-style rule -> grouped; otherwise its own name, so a new organ shows up
 *  rather than vanishing. */
export function normalizeBody(raw: string | null | undefined, cfg: MeetingsTownConfig = DEFAULT_CONFIG): BodyInfo {
  const name = collapse(raw ?? '');
  const hit = cfg.bodies[name];
  if (hit) return hit;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
  const rule = cfg.groupRules.find((r) => r.test.test(name));
  if (rule) return { key, label: name, tone: rule.tone, group: rule.group };
  return { key, label: name || 'Meeting', tone: /school/i.test(name) ? 'school' : 'other' };
}

/** True when the organ string is neither listed, ruled, nor hidden: the QA check "unknown organ in the database" prints these. */
export function isKnownBody(raw: string | null | undefined, cfg: MeetingsTownConfig): boolean {
  const name = collapse(raw ?? '');
  return name in cfg.bodies || cfg.hidden.includes(name) || cfg.groupRules.some((r) => r.test.test(name));
}

/** Organ strings in the rows that the town's table does not know, with how many rows carry each. */
export function unknownBodies(rows: MeetingRow[], cfg: MeetingsTownConfig): { body: string; rows: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = isLegistar(r) ? (r.raw_data?.EventBodyName ?? r.body) : r.body;
    if (!raw || isKnownBody(raw, cfg)) continue;
    counts.set(collapse(raw), (counts.get(collapse(raw)) ?? 0) + 1);
  }
  return [...counts].map(([body, n]) => ({ body, rows: n })).sort((a, b) => b.rows - a.rows || a.body.localeCompare(b.body));
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
export function meetingWhen(row: MeetingRow, tz: string, hasTime: boolean, locale: 'us' | 'gb' = 'us'): MeetingWhen {
  const d = new Date(row.meeting_date);
  if (hasTime) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const t = locale === 'gb'
      ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
      : new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
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
export function formatYmd(ymd: string, withYear = false, locale: 'us' | 'gb' = 'us'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (locale === 'gb') return `${wd} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
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
 *  "Brookings City Council Staff: ..."), not a thing to be decided. Built from the town's bodies (names and labels, with or without
 *  "Brookings"), anchored at the start, so a title that only mentions an organ further in stays. */
const rosterCache = new WeakMap<MeetingsTownConfig, RegExp>();
function rosterFor(cfg: MeetingsTownConfig): RegExp {
  const hit = rosterCache.get(cfg);
  if (hit) return hit;
  const names = new Set<string>();
  for (const [raw, b] of Object.entries(cfg.bodies)) for (const n of [raw, b.label]) { names.add(n); names.add(n.replace(/^Brookings\s+/i, '')); }
  const escape = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = [...names].map(escape).sort((x, y) => y.length - x.length).join('|');
  const rx = new RegExp(`^(brookings\\s+)?(${alt})(\\s+staff)?\\s*:`, 'i');
  rosterCache.set(cfg, rx);
  return rx;
}

/** Titles worth showing: not procedural, 3-200 characters. Verbatim apart from collapsed whitespace and a number prefix. */
export function substantiveItems(titles: string[], cfg: MeetingsTownConfig = DEFAULT_CONFIG): string[] {
  const roster = rosterFor(cfg);
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.replace(/\s+/g, ' ').replace(/^\d+\.+\s*/, '').trim();
    if (t.length < 3 || t.length > MAX_ITEM_TITLE) continue;
    if (PROCEDURAL.test(t) || roster.test(t)) continue;
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

export type MeetingSource = 'legistar' | 'county' | 'agendalink' | 'escribe' | 'coins';

export interface MeetingView {
  id: number;
  source: MeetingSource;
  bodyKey: string;
  bodyLabel: string;
  tone: Tone;
  /** "Regular", "Study session" ... when the source names the kind of meeting instead of the organ */
  typeLabel: string | null;
  closed: boolean;
  /** the source's organ string is in no table of the town: shown under its own name (QA check meetings.unknown-organ) */
  unknownOrgan: boolean;
  /** chip / collapsible group; the organ's own label when it has none */
  chipLabel: string;
  /** set when the organ belongs to a group the town folds away (Glasgow's Area Partnerships) */
  collapsedGroup: string | null;
  ymd: string;
  /** "Tue, Nov 10" / "Tue 10 Nov" */
  dateLabel: string;
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
  /** a Legistar notice of quorum that no real meeting of the same organ and day replaces: shown as the meeting, agenda not yet published */
  quorumNotice: boolean;
  /** the source says the meeting will not take place (a cancellation notice among its documents, or a cancelled status) */
  cancelled: boolean;
  /** when the scraper first stored the row, and when the source says the agenda went out (RSS) */
  firstSeen: string | null;
  agendaPublished: string | null;
}

/** A Legistar "Notice of Quorum" is an off-site notice, not a meeting residents can attend to speak at. */
export function isQuorumNoticeOnly(raw: Record<string, any> | null): boolean {
  const t = String(raw?.agenda_text ?? '');
  return /notice of quorum/i.test(t) && /no official city business/i.test(t);
}

/** A meeting the source itself marks as cancelled: a document titled as a notice of cancellation (eSCRIBE MeetingDocumentLink), a Legistar
 *  status or comment, or a source's own status/title field. Free agenda text is not read: an agenda may discuss a cancellation. */
export function isCancelled(raw: Record<string, any> | null): boolean {
  if (!raw) return false;
  const CANCEL = /cancell?ed|cancell?ation/i;
  const docs: any[] = Array.isArray(raw.MeetingDocumentLink) ? raw.MeetingDocumentLink : [];
  if (docs.some((d) => CANCEL.test(String(d?.Title ?? '')))) return true;
  return [raw.EventAgendaStatusName, raw.EventComment, raw.status, raw.Status, raw.MeetingName, raw.meeting_name]
    .some((v) => typeof v === 'string' && CANCEL.test(v));
}

const isLegistar = (r: MeetingRow) => r.raw_data != null && 'EventId' in r.raw_data;
const isJoint = (r: MeetingRow) => /joint meeting/i.test(String(r.raw_data?.agenda_text ?? '').slice(0, 600)) || /\bjoint\b/i.test(r.body ?? '');

export function sourceOf(r: MeetingRow): MeetingSource {
  const raw = r.raw_data;
  if (!raw) return 'county';
  if ('EventId' in raw) return 'legistar';
  if ('MeetingName' in raw && 'StartDate' in raw) return 'escribe';
  if ('clientId' in raw && 'scheduleIso' in raw) return 'agendalink';
  if ('body_id' in raw && 'local_date' in raw) return 'coins';
  return 'county';
}

/** The organ string of a row as the source spells it. Legistar's own EventBodyName wins over the stored body. */
const rawBodyOf = (r: MeetingRow): string | null => (isLegistar(r) ? (r.raw_data?.EventBodyName ?? r.body) : r.body);

/** One line from a place: lines joined with commas, and a replacement character (U+FFFD, a dash lost in a character-set mix-up between the
 *  source and us) standing between two spaces becomes the dash it was. Any other replacement character is dropped, never shown. */
export function cleanLocation(raw: unknown): string | null {
  const s = String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/ � /g, ' – ')
    .replace(/�/g, '')
    .split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');
  return s || null;
}

/** An absolute http(s) link or null. A sandbox host is never a link on this site (lib/sandbox-url.ts). A relative one is resolved against `base`. */
function safeUrl(url: unknown, base?: string): string | null {
  const u = String(url ?? '').trim();
  if (!u) return null;
  try {
    const abs = new URL(u, base).href;
    return /^https?:/i.test(abs) && !isSandboxUrl(abs) ? abs : null;
  } catch {
    return null;
  }
}

/** eSCRIBE keeps the agenda in MeetingDocumentLink; the HTML agenda reads in a browser, the PDF is the fallback. Resolved against the portal. */
function escribeAgendaUrl(raw: Record<string, any>, portal: string | undefined): string | null {
  const docs: any[] = Array.isArray(raw.MeetingDocumentLink) ? raw.MeetingDocumentLink : [];
  const agenda = (fmt?: string) => docs.find((d) => d?.Type === 'Agenda' && d?.Url && (!fmt || d?.Format === fmt));
  const doc = agenda('HTML') ?? agenda();
  return doc ? safeUrl(doc.Url, portal) : null;
}

function toView(r: MeetingRow, tz: string, hasTime: boolean, cfg: MeetingsTownConfig): MeetingView {
  const source = sourceOf(r);
  const raw = r.raw_data ?? {};
  const b = normalizeBody(rawBodyOf(r), cfg);
  const when = meetingWhen(r, tz, hasTime, cfg.locale);
  const portalHref = cfg.portal?.href;

  let location: string | null = null;
  let agendaUrl: string | null = safeUrl(r.agenda_url);
  let minutesUrl: string | null = safeUrl(r.minutes_url);
  let videoUrl: string | null = null;
  let detailUrl: string | null = null;
  let agendaPublished: string | null = null;
  if (source === 'legistar') {
    location = cleanLocation(raw.EventLocation);
    agendaUrl ??= safeUrl(raw.EventAgendaFile);
    minutesUrl ??= safeUrl(raw.EventMinutesFile);
    videoUrl = safeUrl(raw.EventVideoPath);
    detailUrl = safeUrl(raw.EventInSiteURL);
    agendaPublished = raw.EventAgendaLastPublishedUTC ? String(raw.EventAgendaLastPublishedUTC) : null;
  } else if (source === 'agendalink') {
    const room = raw.room ?? {};
    location = cleanLocation([room.name, room.address?.street].filter(Boolean).join('\n'));
  } else if (source === 'escribe') {
    location = cleanLocation(raw.Location);
    agendaUrl ??= escribeAgendaUrl(raw, portalHref);
  } else if (source === 'coins') {
    location = cleanLocation(raw.location);
    // The stored agenda_url of a meeting whose agenda is not out yet is the committee page; only the source's own agenda_url is an agenda.
    agendaUrl = safeUrl(raw.agenda_url);
    detailUrl = safeUrl(raw.committee_url);
    const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw.agenda_published ?? ''));
    agendaPublished = p ? `${p[3]}-${p[2]}-${p[1]}` : null;
  }

  let items = substantiveItems(rawAgendaTitles(r.raw_data), cfg);
  if (cfg.locale === 'gb') items = items.filter((t) => !ukTitleHeld(t));
  const created = r.created_at ? new Date(r.created_at).toISOString() : null;
  return {
    id: r.id,
    source,
    bodyKey: b.key, bodyLabel: b.label, tone: b.tone,
    typeLabel: b.type ?? null, closed: !!b.closed, unknownOrgan: !isKnownBody(rawBodyOf(r), cfg),
    chipLabel: b.group ?? b.label,
    collapsedGroup: b.group && cfg.collapsedGroups.includes(b.group) ? b.group : null,
    ymd: when.ymd, dateLabel: formatYmd(when.ymd, false, cfg.locale), time: when.time, startMs: when.startMs,
    location, agendaUrl, minutesUrl, videoUrl, detailUrl,
    storySlug: r.story_slug ?? null,
    items: b.closed || isCancelled(r.raw_data) ? [] : items,
    topics: [],
    jointWith: null,
    quorumNotice: false,
    cancelled: isCancelled(r.raw_data),
    firstSeen: created,
    agendaPublished,
  };
}

export interface DedupeNote { dropped: number; kept: number; why: string }

/** Rows -> one view per real meeting, oldest first.
 *  1. A "Notice of Quorum" is not a meeting. It is dropped only when a real row has the same local date and organ; otherwise it stands for the
 *     meeting (the organ's date is known, the agenda is not yet published) and is marked `quorumNotice`.
 *  2. Same local date + same organ + same kind of meeting: keep the Legistar row (the city's own system). Fields the kept row lacks (agenda
 *     link, agenda items, story) are filled from the dropped one; time, place and organ stay Legistar's. A Regular and a Study session on one
 *     day are two meetings.
 *  3. Different organs are never merged, except a city and a county row on the same day that both say "joint meeting": the Legistar row
 *     stays and is marked joint.
 *  Organs the town hides (cfg.hidden) are removed first. */
export function buildMeetings(
  rows: MeetingRow[], tz: string, hasTime: boolean, notes?: DedupeNote[], cfg: MeetingsTownConfig = DEFAULT_CONFIG,
): MeetingView[] {
  const shown = rows.filter((r) => !cfg.hidden.includes(collapse(rawBodyOf(r) ?? '')));
  const all = shown.map((r) => ({ row: r, quorum: isQuorumNoticeOnly(r.raw_data), v: toView(r, tz, hasTime, cfg) }));
  const slot = (v: MeetingView) => `${v.ymd}|${v.bodyKey}|${v.typeLabel ?? ''}`;
  const dayOrgan = (v: MeetingView) => `${v.ymd}|${v.bodyKey}`;
  const realDays = new Set(all.filter((x) => !x.quorum).map((x) => dayOrgan(x.v)));
  const dropped = new Set<number>();
  for (const x of all) {
    if (!x.quorum) continue;
    if (realDays.has(dayOrgan(x.v))) {
      dropped.add(x.v.id);
      notes?.push({ dropped: 1, kept: 0, why: `notice of quorum ${x.v.ymd} ${x.v.bodyLabel}: a real meeting of the same organ and day exists` });
    } else {
      x.v.quorumNotice = true;
      x.v.agendaUrl = null; // the file behind a notice of quorum is the notice, not an agenda
      x.v.items = [];
      x.v.topics = [];
    }
  }
  const views = all.filter((x) => !dropped.has(x.v.id));
  const byKey = new Map<string, typeof views>();
  for (const x of views) {
    const k = slot(x.v);
    byKey.set(k, [...(byKey.get(k) ?? []), x]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(a.v.quorumNotice) - Number(b.v.quorumNotice) || Number(b.v.source === 'legistar') - Number(a.v.source === 'legistar') || a.v.id - b.v.id);
    const [keep, ...rest] = group;
    for (const d of rest) {
      keep.v.agendaUrl ??= d.v.agendaUrl;
      keep.v.minutesUrl ??= d.v.minutesUrl;
      keep.v.storySlug ??= d.v.storySlug;
      if (keep.v.items.length === 0) keep.v.items = d.v.items;
      dropped.add(d.v.id);
    }
    notes?.push({ dropped: rest.length, kept: keep.v.id, why: `same date + organ (${keep.v.ymd} ${keep.v.bodyLabel}${keep.v.typeLabel ? ` ${keep.v.typeLabel}` : ''})` });
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
  if (cfg.topicLabels) for (const v of out) v.topics = topicsFor(v.items);
  return out.sort((a, b) => (a.startMs ?? Date.parse(a.ymd)) - (b.startMs ?? Date.parse(b.ymd)) || a.id - b.id);
}

/** What a card says when it has no agenda lines. Closed sessions promise none; a quorum notice says the agenda is not out yet. */
export function agendaNote(m: MeetingView): string | null {
  if (m.closed || m.cancelled || m.items.length > 0) return null;
  if (m.quorumNotice) return 'Members may be present. No agenda posted.';
  return m.agendaUrl ? null : 'No agenda published';
}

/** Meetings still ahead: a dated meeting stays "upcoming" through its own day; a timed one for 3 h after it starts. */
export function isUpcoming(m: MeetingView, nowMs: number, todayYmd: string): boolean {
  return m.startMs != null ? m.startMs + 3 * 3_600_000 >= nowMs : m.ymd >= todayYmd;
}

/** How many meetings each chip would filter to. Pass the result to the Chips component (ui-helpers planChips): a chip needs >= 3 meetings. */
export function chipCounts(ms: MeetingView[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of ms) out[m.chipLabel] = (out[m.chipLabel] ?? 0) + 1;
  return out;
}

/** The organs that can be followed (RSS, calendar): one entry per organ key, in order of first appearance. */
export function organChips(ms: MeetingView[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const m of ms) if (!seen.has(m.bodyKey)) seen.set(m.bodyKey, m.bodyLabel);
  return [...seen].map(([key, label]) => ({ key, label }));
}

/** Every organ a resident can follow: the town's listed organs plus any organ the data has (rule-matched ones such as Area Partnerships), by label.
 *  Feeds exist for all of them whether or not a meeting is scheduled today, so a subscription never turns into a 404. */
export function followableOrgans(ms: MeetingView[], cfg: MeetingsTownConfig): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const b of Object.values(cfg.bodies)) if (!seen.has(b.key)) seen.set(b.key, b.label);
  for (const o of organChips(ms)) if (!seen.has(o.key)) seen.set(o.key, o.label);
  return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The title a meeting carries in a calendar or a feed: "City Council", or "City Council · Study session" when the source names the kind. */
export const meetingTitle = (m: MeetingView): string =>
  m.quorumNotice ? `${m.bodyLabel} – quorum notice` : m.typeLabel ? `${m.bodyLabel} · ${m.typeLabel}` : m.bodyLabel;

/* ------------------------------------------------------------- ics, ld */

/** Meetings that can go in a calendar: a real start instant and a place. A quorum notice is not a verified meeting and stays out. */
export const canCalendar = (m: MeetingView): boolean => m.startMs != null && !!m.location && !m.quorumNotice && !m.cancelled;

type IcsSite = { siteName: string; domain: string };

function icsEvent(m: MeetingView, site: IcsSite, pageUrl: string, stamp: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:meeting-${m.id}@${site.domain}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(new Date(m.startMs!).toISOString())}`,
    `SUMMARY:${escapeIcsText(`${meetingTitle(m)} meeting`)}`,
    `LOCATION:${escapeIcsText(m.location!)}`,
    ...(m.agendaUrl ? [`DESCRIPTION:${escapeIcsText(`Agenda: ${m.agendaUrl}`)}`] : []),
    `URL:${pageUrl}`,
    'END:VEVENT',
  ];
}

function icsCalendar(site: IcsSite, name: string | null, events: string[][]): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${site.siteName}//Meetings//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(name ? [`X-WR-CALNAME:${escapeIcsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'] : []),
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function buildMeetingIcs(m: MeetingView, site: IcsSite, pageUrl: string): string | null {
  if (!canCalendar(m)) return null;
  return icsCalendar(site, null, [icsEvent(m, site, pageUrl, toIcsUtc(new Date().toISOString()))]);
}

/** A subscribable calendar: every meeting in `ms` that can go in a calendar, in one file. An empty list is still a valid calendar, so a
 *  subscription to an organ with nothing scheduled keeps working. `name` is what the calendar app shows. */
export function buildMeetingsFeedIcs(ms: MeetingView[], site: IcsSite, pageUrl: string, name: string): string {
  const stamp = toIcsUtc(new Date().toISOString());
  return icsCalendar(site, name, ms.filter(canCalendar).map((m) => icsEvent(m, site, pageUrl, stamp)));
}

function isoWithOffset(ms: number, tz: string): string {
  const off = tzOffsetMinutes(ms, tz);
  const local = new Date(ms + off * 60000).toISOString().slice(0, 19);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Event JSON-LD for an upcoming meeting; null unless it has a real start and a place, and comes from the city's own system (Legistar). */
export function buildMeetingJsonLd(
  m: MeetingView, tz: string, place: { locality: string; region: string; country: string }, organizer: string, pageUrl: string,
): Record<string, unknown> | null {
  if (m.source !== 'legistar' || !canCalendar(m)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${meetingTitle(m)} meeting`,
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

/* ------------------------------------------------------------------ rss */

export interface FeedItem { guid: string; title: string; link: string; pubDate: Date; description: string }

const whenLine = (m: MeetingView) => `${m.dateLabel}${m.time ? `, ${m.time}` : ''}`;

/** One item per event that is new: a meeting we first stored ("New meeting"), and an agenda the source dates itself ("Agenda published";
 *  Legistar's EventAgendaLastPublishedUTC, Glasgow's agenda_published). AgendaLink and eSCRIBE give no publish date, so those towns get only
 *  the first item. Titles and descriptions are built from fields; nothing is written. Newest first. Every item has its own link: the RSS library derives the item's guid from it, and
 *  readers drop an item whose guid they have seen. */
export function buildMeetingFeedItems(ms: MeetingView[], pageUrl: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of ms) {
    const facts = [whenLine(m), m.location].filter(Boolean).join(' · ');
    if (m.firstSeen) {
      out.push({ guid: `meeting-${m.id}-scheduled`, title: `${m.cancelled ? 'Cancelled meeting' : 'New meeting'}: ${meetingTitle(m)}, ${whenLine(m)}`, link: `${pageUrl}#meeting-${m.id}`, pubDate: new Date(m.firstSeen), description: facts });
    }
    const published = m.agendaPublished ? new Date(m.agendaPublished) : null;
    if (published && !Number.isNaN(published.getTime()) && (m.items.length > 0 || m.agendaUrl) && !m.quorumNotice && !m.cancelled) {
      out.push({ guid: `meeting-${m.id}-agenda`, title: `Agenda published: ${meetingTitle(m)}, ${whenLine(m)}`, link: m.agendaUrl ?? `${pageUrl}#meeting-${m.id}`, pubDate: published, description: facts });
    }
  }
  return out.filter((i) => !Number.isNaN(i.pubDate.getTime())).sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

/** Meta description that leads with the next meeting ("Next: City Council, Tue, Nov 10, 5:30 PM. ..."), kept inside the site's
 *  155-character limit; null when it would not fit, so the caller keeps the standard description. */
export function nextMeetingDescription(m: MeetingView, cityName: string): string | null {
  const text = `Next: ${meetingTitle(m)}, ${whenLine(m)}. Agendas for ${cityName} council, commission and committee meetings, and how to follow or speak.`;
  return text.length <= 155 ? text : null;
}

/** Meetings per archive page (towns on the structured layout only). */
export const ARCHIVE_PAGE_SIZE = 25;
