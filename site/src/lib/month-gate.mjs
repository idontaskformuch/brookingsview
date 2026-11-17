/**
 * The /month/<yyyy-mm>/ index gate (audit Fas 7a, P1-10), counted ONE way for both consumers: the page's own noindex
 * (pages/month/[slug].astro via lib/month-in-review.ts) and the sitemap filter in astro.config.mjs. No DB or site-config
 * imports, like week-count.mjs. Types: month-gate.d.mts.
 *
 * Owner decisions 2026-11-17:
 *   1. A module counts toward MIN_MODULES_FOR_INDEX only if its rows IN THE MONTH reach MONTH_GATE_MINIMUMS. The month is the
 *      town's local calendar month, not UTC: an instant (traffic/jobs created_at, events occurs_at) is read in the town's zone,
 *      a meeting date by lib/meeting-day.mjs (Brookings' bare Legistar dates read as UTC Y/M/D), a DATE column (sale_date) as is.
 *   2. The rows counted are the rows the module's own SQL returns for the month, BEFORE classification (traffic/events zone,
 *      jobs zone, decision outcome). Projects and jobs count distinct values, like the sentences do.
 *   3. Every month from MONTH_IN_REVIEW_START gets a page; one that fails the gate is noindex, never a 404.
 *
 * A module whose source had not started yet in the month (floor month after the target month) has status 'none', renders
 * nothing and never counts, whatever its rows.
 */
import { localDateParts } from './event-dedup.mjs';
import { meetingDayParts } from './meeting-day.mjs';

/** First month with a page, per town. A town without an entry has no /month/ pages (Fas 4 turns this into a config flag). */
export const MONTH_IN_REVIEW_START = {
  moreno_valley_ca: { year: 2026, month: 8 },
};

export const MIN_MODULES_FOR_INDEX = 4;

/** Rows in the month a module needs before it counts toward MIN_MODULES_FOR_INDEX (owner 2026-11-17). */
export const MONTH_GATE_MINIMUMS = {
  decisions: 5,
  projects: 2, // distinct projects
  sales: 15,
  events: 10,
  traffic: 10,
  jobs: 20, // distinct title + company
};

export const MONTH_MODULE_KINDS = ['decisions', 'projects', 'sales', 'events', 'traffic', 'jobs'];

/** The date column each module buckets by. */
export const MONTH_ROW_DATE_FIELD = {
  decisions: 'meeting_date',
  projects: 'entry_date',
  sales: 'sale_date',
  events: 'occurs_at',
  traffic: 'created_at',
  jobs: 'created_at',
};

const DAY_MS = 86_400_000;

/** UTC instants wide enough to hold the local month in any zone (one day either side). Callers fetch rows in this window and
 *  keep the ones rowsInMonth() accepts -- the SQL alone never decides the month. */
export function monthQueryWindow(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1) - DAY_MS);
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) + DAY_MS);
  return { start, end };
}

/** A DATE column, like lib/calendar-date.ts calendarDateParts(): the Neon driver turns 'YYYY-MM-DD' into a Date at LOCAL
 *  midnight of the build machine, so a Date is read with local getters (UTC getters give the previous day east of UTC). */
function bareDateParts(value) {
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return { y, m, d };
  }
  return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
}

/** { y, m (1-12) } of a value's local calendar month for this module, or null without a date. */
export function localMonthOf(kind, value, timezone, meetingsHaveTime) {
  if (value == null || value === '') return null;
  if (kind === 'decisions' || kind === 'projects') {
    const p = meetingDayParts(value, timezone, meetingsHaveTime);
    return p ? { y: p.y, m: p.m } : null;
  }
  if (kind === 'sales') {
    const p = bareDateParts(value);
    return { y: p.y, m: p.m };
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const p = localDateParts(instant, timezone);
  return { y: p.y, m: p.m };
}

export function rowsInMonth(kind, rows, year, month, timezone, meetingsHaveTime) {
  const field = MONTH_ROW_DATE_FIELD[kind];
  return rows.filter((r) => {
    const p = localMonthOf(kind, r[field], timezone, meetingsHaveTime);
    return p !== null && p.y === year && p.m === month;
  });
}

/** Same key the jobs sentence counts by: one posting per title + company. */
export function jobDistinctKey(title, company) {
  return `${title.trim().toLowerCase()}|${(company ?? '').trim().toLowerCase()}`;
}

/** What the gate counts for a module's rows in the month (decision 2: before classification). Decisions keep their
 *  'pending' rows because the module's own SQL (lib/db.ts getMeetingDecisionsInMonth, mirrored in astro.config.mjs) fetches
 *  every meeting_decisions row with no outcome filter -- pending is dropped only by the sentence's outcome split. */
export function gateCount(kind, monthRows) {
  if (kind === 'projects') return new Set(monthRows.map((r) => r.project_slug)).size;
  if (kind === 'jobs') return new Set(monthRows.map((r) => jobDistinctKey(r.title, r.company))).size;
  return monthRows.length;
}

/** 'full' (source running before the month), 'partial' (the source's first month), 'none' (not started, or no floor).
 *  Compared by local month, with the floor read the same way as the module's rows (events: published_at as an instant). */
export function floorStatus(kind, floor, year, month, timezone, meetingsHaveTime) {
  const p = localMonthOf(kind, floor, timezone, meetingsHaveTime);
  if (!p) return 'none';
  const floorKey = p.y * 12 + p.m;
  const monthKey = year * 12 + month;
  if (floorKey < monthKey) return 'full';
  if (floorKey === monthKey) return 'partial';
  return 'none';
}

export function moduleClears(kind, status, count) {
  return status !== 'none' && count >= MONTH_GATE_MINIMUMS[kind];
}

/** The modules that reach their minimum, for one town + month: the ones the page shows AND the gate counts. A module under
 *  its minimum, 0 rows included, is neither shown nor counted (owner 2026-11-17).
 *  @param {Record<string, { status: string, gateCount: number }>} modules keyed by MONTH_MODULE_KINDS */
export function clearedModuleKinds(modules) {
  return MONTH_MODULE_KINDS.filter((k) => modules[k] && moduleClears(k, modules[k].status, modules[k].gateCount));
}

export function clearedModuleCount(modules) {
  return clearedModuleKinds(modules).length;
}

/** Whole gate from raw rows -- what astro.config.mjs's sitemap filter calls. `data[kind]` = { rows, floor } for every kind
 *  but sales, which has no floor (a month with rows is 'full', see month-in-review.ts buildSalesModule). */
export function monthGate(data, year, month, timezone, meetingsHaveTime) {
  const modules = {};
  for (const kind of MONTH_MODULE_KINDS) {
    const monthRows = rowsInMonth(kind, data[kind]?.rows ?? [], year, month, timezone, meetingsHaveTime);
    const status = kind === 'sales'
      ? (monthRows.length > 0 ? 'full' : 'none')
      : floorStatus(kind, data[kind]?.floor ?? null, year, month, timezone, meetingsHaveTime);
    modules[kind] = { status, gateCount: gateCount(kind, monthRows) };
  }
  const cleared = clearedModuleCount(modules);
  return { modules, cleared, indexable: cleared >= MIN_MODULES_FOR_INDEX };
}

/** Every month from MONTH_IN_REVIEW_START up to (not including) the town's current local month, oldest first. */
export function monthsFromStart(townId, timezone, now = new Date()) {
  const start = MONTH_IN_REVIEW_START[townId];
  if (!start) return [];
  const today = localDateParts(now, timezone);
  const months = [];
  let y = start.year;
  let m = start.month;
  while (y < today.y || (y === today.y && m < today.m)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}
