/** "<Town> in numbers" (Fas 4): loads the rows from our own DB and builds lib/town-numbers.ts NumberRows. Each number is counted the
 *  way its own page counts it:
 *   - events: published event stories occurring in the latest full local week (getEventOccurrencesBetween, same WHERE as /month/).
 *   - closures (D3): the /traffic/ page's current list -- the latest successful read, zone-classified with classifyTrafficIncident(),
 *     deduped, trafficKind 'closure' only; hidden when that read is not fresh (lib/traffic-read.ts). Line: closures in town or on an
 *     approach road listed during each week.
 *   - jobs (D4): /jobs/'s rule (lib/jobs-hero.ts firstPostedByKey + newJobCount: an employer + title pair whose first posting in this
 *     town is in the last 7 days; a repost is not new); hidden when the jobs source has not read successfully for 7 days.
 *   - meetings / decisions: the last full local month; meetings the source marks cancelled are left out, decisions still pending are
 *     not counted. No line: their span is a month, and D1's lines are 12 full weeks.
 *  Home sales are not a number anywhere (owner 2026-11-19: Moreno Valley's source has had no sale since 31 Oct 2025). */
import {
  getOkReadStarts, getEventOccurrencesBetween, getTrafficClosureCandidatesSeenSince, getMeetingDatesBetween, getMeetingDecisionsInMonth,
  getTrafficLatestRead, getTrafficIncidentsListedAt, getJobFirstPostings, getEventSourceStarts,
} from './db';
import { FROZEN_EVENT_SOURCES } from './frozen-sources.mjs';
import { siteConfig } from './site-config';
import { isSectionBuilt } from './sections';
import { homeRailFor } from '../config/home-rail';
import { classifyTrafficIncident, trafficKind } from './traffic';
import { dedupeTrafficIncidents } from './traffic-hero';
import { trafficReadState } from './traffic-read';
import { firstPostedByKey, newJobCount } from './jobs-hero';
import { monthQueryWindow, rowsInMonth } from './month-gate.mjs';
import { isCancelled } from './meetings-view';
import {
  NUMBERS_WEEKS, JOBS_READ_MAX_AGE_DAYS, fullWeeks, weekOf, weekStartDay, countByWeek, coveredSeries, weeklyRow, closureWeekSpans,
  lastFullMonth, readWithin, pickRows, readsSteady, readEveryWeek, sourcesConstant, type Coverage, type NumberRow, type SourceSpan,
} from './town-numbers';

const DAY_MS = 86_400_000;

function readsByWeek(read: { starts: string[] }, tz: string): Map<number, number> {
  const n = new Map<number, number>();
  for (const s of read.starts) { const w = weekOf(s, tz); n.set(w, (n.get(w) ?? 0) + 1); }
  return n;
}

function coverage(read: { first: string | null; starts: string[] }, tz: string, zeroIsGap = false): Coverage {
  return { firstReadWeek: read.first ? weekOf(read.first, tz) : null, readWeeks: readsByWeek(read, tz), zeroIsGap };
}

/** A count read from one source (traffic, jobs): its start is the first successful read. */
const oneSource = (name: string, read: { first: string | null }, tz: string): SourceSpan[] =>
  [{ name, startWeek: read.first ? weekOf(read.first, tz) : null, stopWeek: null }];

export async function loadTownNumbers(now: Date): Promise<NumberRow[]> {
  const tz = siteConfig.timezone;
  const locale = siteConfig.country === 'gb' ? 'en-GB' : 'en-US';
  const noTrend = new Set(homeRailFor(siteConfig.townId).numbersNoTrend ?? []);
  const weeks = fullWeeks(now, tz);
  // UTC instants a day either side of the local weeks (the week of each row is decided in TS, not by the SQL).
  const from = new Date(weekStartDay(weeks[0]) * DAY_MS - DAY_MS);
  const to = new Date(weekStartDay(weeks[weeks.length - 1] + 1) * DAY_MS + DAY_MS);
  const span = `weekly counts for the last ${NUMBERS_WEEKS} full weeks`;
  const hasTraffic = isSectionBuilt('traffic', siteConfig);
  const hasJobs = isSectionBuilt('jobs', siteConfig);
  const month = lastFullMonth(now, tz, locale);
  const mWin = monthQueryWindow(month.y, month.m);

  const [eventSources, eventReads, events, trafficReads, trafficRun, closureRows, jobReads, jobFirsts, meetings, decisions] = await Promise.all([
    getEventSourceStarts(),
    getOkReadStarts('events', from),
    getEventOccurrencesBetween(from, to),
    hasTraffic ? getOkReadStarts('traffic', from) : null,
    hasTraffic ? getTrafficLatestRead() : null,
    hasTraffic ? getTrafficClosureCandidatesSeenSince(from) : [],
    hasJobs ? getOkReadStarts('jobs', from) : null,
    hasJobs ? getJobFirstPostings() : [],
    getMeetingDatesBetween(mWin.start, mWin.end),
    getMeetingDecisionsInMonth(mWin.start, mWin.end),
  ]);

  const rows: (NumberRow | null)[] = [];

  // Events: the latest full week's count; hidden when that week is not covered.
  {
    const series = coveredSeries(countByWeek(events.map((e) => weekOf(e, tz)), weeks), weeks, coverage(eventReads, tz, true));
    const value = series[series.length - 1];
    // Sources: each one's first row, and a frozen one's stop (Moreno Valley's Tockify feeds, 13 Nov 2026) -- a source that stops
    // must not look like a fall.
    const frozen = (FROZEN_EVENT_SOURCES as Record<string, Record<string, { since: string }>>)[siteConfig.townId] ?? {};
    const sources: SourceSpan[] = eventSources.map((s) => ({
      name: s.source, startWeek: weekOf(s.first, tz), stopWeek: frozen[s.source] ? weekOf(`${frozen[s.source].since}T12:00:00Z`, tz) : null,
    }));
    // Beslut 8: events and jobs need a read every week and unchanged sources; only traffic also needs a steady read count.
    const comparable = readEveryWeek(readsByWeek(eventReads, tz), weeks) && sourcesConstant(sources, weeks);
    rows.push(value == null ? null : weeklyRow({
      id: 'events', label: 'Events last week', value, href: '/events/', span, series, weeks, trend: !noTrend.has('events'), locale, comparable,
    }));
  }

  // Closures (D3).
  if (hasTraffic && trafficReads) {
    const read = trafficReadState(trafficRun, now);
    if (read.kind === 'fresh') {
      const inZone = <T extends Parameters<typeof classifyTrafficIncident>[0]>(r: T) =>
        classifyTrafficIncident(r, siteConfig.townId, siteConfig.trafficCorridors, siteConfig.trafficCorridorMaxMiles) !== null;
      const current = dedupeTrafficIncidents((await getTrafficIncidentsListedAt(read.start)).filter(inZone))
        .filter((r) => trafficKind(r) === 'closure');
      const listed = dedupeTrafficIncidents(closureRows.filter((r) => trafficKind(r) === 'closure' && inZone(r)))
        .filter((r): r is typeof r & { created_at: string } => r.created_at != null);
      const series = coveredSeries(countByWeek(closureWeekSpans(listed, tz), weeks), weeks, coverage(trafficReads, tz));
      rows.push(weeklyRow({
        id: 'closures', label: 'Active road closures', value: current.length, href: '/traffic/',
        span: `road closures listed per week, last ${NUMBERS_WEEKS} full weeks`, series, weeks, trend: !noTrend.has('closures'), locale,
        comparable: readsSteady(readsByWeek(trafficReads, tz), weeks) && sourcesConstant(oneSource('traffic', trafficReads, tz), weeks),
      }));
    }
  }

  // Jobs (D4).
  if (hasJobs && jobReads) {
    const lastRead = jobReads.starts.reduce<string | null>((a, s) => (a === null || new Date(s) > new Date(a) ? s : a), null);
    if (readWithin(lastRead, now, JOBS_READ_MAX_AGE_DAYS)) {
      const first = firstPostedByKey(jobFirsts, siteConfig.townId);
      const series = coveredSeries(countByWeek([...first.values()].map((t) => weekOf(new Date(t), tz)), weeks), weeks, coverage(jobReads, tz));
      rows.push(weeklyRow({
        id: 'jobs', label: 'New job listings, past 7 days', value: newJobCount(first, now), href: '/jobs/',
        span: `new listings per week, last ${NUMBERS_WEEKS} full weeks`, series, weeks, trend: !noTrend.has('jobs'), locale,
        comparable: readEveryWeek(readsByWeek(jobReads, tz), weeks) && sourcesConstant(oneSource('jobs', jobReads, tz), weeks),
      }));
    }
  }

  // Meetings and decisions: the last full month.
  const meetingsInMonth = rowsInMonth('decisions', meetings, month.y, month.m, tz, siteConfig.meetingsHaveTime).filter((m) => !isCancelled(m.raw_data));
  if (meetingsInMonth.length > 0) {
    rows.push({ id: 'meetings', label: `Public meetings in ${month.name}`, value: meetingsInMonth.length, href: '/city-hall/', line: null, span: null, insight: null });
  }
  const decided = rowsInMonth('decisions', decisions, month.y, month.m, tz, siteConfig.meetingsHaveTime).filter((d) => d.outcome !== 'pending');
  if (decided.length > 0) {
    rows.push({ id: 'decisions', label: `Decisions recorded in ${month.name}`, value: decided.length, href: '/city-hall/', line: null, span: null, insight: null });
  }

  return pickRows(rows);
}
