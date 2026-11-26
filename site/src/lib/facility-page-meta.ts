/** A /facilities/<slug>/ page's <title> and meta description from its structured data (owner order 2026-11-26 (11), (14)): the same rules as
 *  the answer pages (lib/answer-facility.ts), fed from the facility row, its effective weekly hours (the rows the page's table shows) and its
 *  closed days. Nothing is read out of free text: hours that exist only as the source's text give no "Open" part. `fallbacks` says, for the
 *  review table and the build log, which part was left out and why. */
import type { AnswerFacility, FacilityHours } from '../config/city-answers/types';
import { admissionRelevant } from '../config/facility-admission';
import { facilityMeta, facilityTitle } from './answer-facility';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
/** How many days ahead a day calendar must cover, all with the same pattern, before its regular week is told as "Open" (owner order
 *  2026-11-26 (16) 1: four weeks). */
export const CALENDAR_WEEKS = 4;

export interface FacilityRow {
  name: string;
  /** places.category: "Free" is said only for a type where entry is a question (config/facility-admission.ts). */
  category?: string | null;
  /** places.hours_structured as stored: a plain week's null day is the source saying "closed" (USPS: sunday null). */
  hours_structured?: unknown;
  street_address?: string | null;
  /** The address as the page shows it ("250 Spader Way, Broomfield, CO 80020"); used when there is no street_address and it names a street. */
  address?: string | null;
  /** The page's own description; its first sentence is the meta's preferred last sentence. */
  description?: string | null;
  phone?: string | null;
  hours_text?: string | null;
  is_free?: boolean | null;
  services?: string[] | null;
  accessibility_note?: string | null;
}

export interface FacilityMetaInput {
  facility: FacilityRow;
  /** The effective weekly hours the page's table shows (lib/hours-spec.ts effectiveHours rows): a day with no times is closed that day. */
  hoursRows: { day_of_week: number; opens: string | null; closes: string | null }[];
  /** The place's own hours are older than the town's staleness threshold: the meta does not repeat them. */
  hoursStale: boolean;
  /** Where the hours come from (lib/hours-spec.ts effectiveHours): the place's own rows, or the town's city park rule (shown on the page
   *  as "City park hours" with the city's own wording). Staleness is about the place's own rows only, as on the page. */
  hoursSource?: 'own' | 'city-park-rule' | null;
  /** Upcoming exceptions (place_hours_exceptions); both times null = closed that day. */
  exceptions: { date: string; opens: string | null; closes: string | null }[];
  /** Upcoming events at the place, as the page lists them. */
  upcomingEvents: number;
  /** A day calendar's rows (place_hours with valid_from, Briggs Library from LibCal), as "YYYY-MM-DD"; then `hoursRows` is only the next
   *  seven days and the meta's "Open" is the regular week read from these (regularWeekFromCalendar), never one week's calendar. */
  datedRows?: { valid_from: string; valid_to: string | null; day_of_week: number; opens: string | null; closes: string | null }[];
}

function addDays(iso: string, n: number): { iso: string; weekday: number } {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return { iso: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}

/** A day calendar read as a regular week (owner order 2026-11-26 (16) 1). Every one of the CALENDAR_WEEKS * 7 days from `today` must be in
 *  the calendar, and each weekday must have one pattern of times on every open occurrence; a closed occurrence of a weekday that is
 *  otherwise open is a holiday closure (it goes to "Next closed", it does not take the day out of the week), but only while it is fewer
 *  than half of that weekday's occurrences. Any other difference (later hours one week, a gap in the calendar) means the regular week cannot
 *  be told for sure: `week` is null. `closedDates` are the holiday closures, in date order, whether or not the week could be told. */
export function regularWeekFromCalendar(
  rows: NonNullable<FacilityMetaInput['datedRows']>, today: string,
): { week: FacilityMetaInput['hoursRows'] | null; closedDates: string[] } {
  const days: { iso: string; weekday: number; key: string; windows: { opens: string; closes: string }[] }[] = [];
  let gap = false;
  for (let n = 0; n < CALENDAR_WEEKS * 7; n++) {
    const { iso, weekday } = addDays(today, n);
    const cover = rows.filter((r) => r.valid_from <= iso && (!r.valid_to || r.valid_to >= iso));
    if (cover.length === 0) { gap = true; continue; }
    const windows = cover.filter((r) => r.opens && r.closes).map((r) => ({ opens: time(r.opens!), closes: time(r.closes!) }))
      .sort((a, b) => a.opens.localeCompare(b.opens));
    days.push({ iso, weekday, key: windows.map((w) => `${w.opens}-${w.closes}`).join(','), windows });
  }
  const openSomewhere = new Set(days.filter((d) => d.key).map((d) => d.weekday));
  const closedDates = days.filter((d) => !d.key && openSomewhere.has(d.weekday)).map((d) => d.iso);
  if (gap) return { week: null, closedDates };
  const week: FacilityMetaInput['hoursRows'] = [];
  for (let wd = 0; wd < 7; wd++) {
    const occ = days.filter((d) => d.weekday === wd);
    const open = occ.filter((d) => d.key);
    const patterns = new Set(open.map((d) => d.key));
    if (patterns.size > 1) return { week: null, closedDates };
    if (open.length === 0) { week.push({ day_of_week: wd, opens: null, closes: null }); continue; }
    if ((occ.length - open.length) * 2 >= occ.length) return { week: null, closedDates };
    for (const w of open[0].windows) week.push({ day_of_week: wd, opens: w.opens, closes: w.closes });
  }
  return { week, closedDates };
}

/** A dated effective week's pill rows (lib/hours-spec.ts, valid_from already "YYYY-MM-DD") as `datedRows`. */
export function datedCalendarRows(
  rows: { valid_from: string | null; valid_to: string | null; day_of_week: number; opens: string | null; closes: string | null }[],
): NonNullable<FacilityMetaInput['datedRows']> {
  return rows.filter((r) => !!r.valid_from).map((r) => ({
    valid_from: r.valid_from!, valid_to: r.valid_to, day_of_week: r.day_of_week, opens: r.opens, closes: r.closes,
  }));
}

/** Weekdays the source's own plain week (hours_structured) gives as closed: a null day. A seasonal or missing week says nothing. */
export function sourceClosedDays(h: unknown): number[] {
  if (!h || typeof h !== 'object' || Array.isArray((h as { seasons?: unknown }).seasons)) return [];
  const w = h as Record<string, unknown>;
  return DAY_KEYS.flatMap((k, i) => (k in w && w[k] === null ? [i] : []));
}

const time = (t: string) => (/^\d/.test(t) ? t.slice(0, 5) : t);

/** The first sentence of the page's own description (up to its first full stop followed by a space or the end); null without one. */
export function firstSentence(text: string | null | undefined): string | null {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : `${t}.`;
}

/** Weekly rows grouped by identical times, in day order of the first day each window appears ("Mon–Fri 9–5" from five rows). */
export function groupHours(rows: FacilityMetaInput['hoursRows']): FacilityHours[] {
  const order = [1, 2, 3, 4, 5, 6, 0]; // a week reads Monday first; the group keeps its days as numbers (0 = Sunday)
  const groups = new Map<string, FacilityHours>();
  for (const d of order) {
    for (const r of rows.filter((x) => x.day_of_week === d && x.opens && x.closes)) {
      const key = `${time(r.opens!)}|${time(r.closes!)}`;
      const g = groups.get(key) ?? { days: [], from: time(r.opens!), to: time(r.closes!) };
      if (!g.days.includes(d)) g.days.push(d);
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}

/** A handwritten meta for a page whose structured data says too little (owner order 2026-11-26 (15) 3): factual, only what the page shows,
 *  at most META_MAX. Keyed by town id, then slug. */
export const HANDWRITTEN_META: Record<string, Record<string, string>> = {
  brookings_sd: {
    // The page's own first sentence (places.description), without its quotation marks so that it fits.
    'downtown-main-avenue': 'Brookings\' downtown commercial district along Main Avenue, home to the recurring Downtown at Sundown event series and other street-level community events.',
  },
};

/** What only the page has, as the meta's last sentence ("Includes phone number, services and upcoming events."), then the same list
 *  shortened from its end ("Includes phone number and services.", "Includes phone number."), so that a meta too long for the whole list
 *  keeps its first items instead of losing the sentence. Empty when the page has none of them. */
export function onPageLines(i: FacilityMetaInput): string[] {
  const f = i.facility;
  const parts = [
    f.phone ? 'phone number' : null,
    f.services && f.services.length > 0 ? 'services' : null,
    f.accessibility_note ? 'accessibility' : null,
    i.upcomingEvents > 0 ? 'upcoming events' : null,
  ].filter((p): p is string => !!p);
  const line = (p: string[]) => `Includes ${p.length === 1 ? p[0] : `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`}.`;
  // A sentence, never the fragment "Phone number." (owner order 2026-11-26 (15) C).
  return parts.map((_, k) => line(parts.slice(0, parts.length - k)));
}
/** The whole list (onPageLines' first), or null. */
export const onPageLine = (i: FacilityMetaInput): string | null => onPageLines(i)[0] ?? null;

/** The week states every day: each of the seven has times or is a day the source says is closed (a row without times, or a null day in
 *  the source's own week, `closedBySource`, which the page's table shows as "Closed"). A day known neither way is not known, so a week
 *  with one is not shown as "Open" (owner order 2026-11-26 (15) A, (16) 4: the meta never says more than the page and its source). */
export function statesWholeWeek(rows: FacilityMetaInput['hoursRows'], closedBySource: number[] = []): boolean {
  return new Set([...rows.map((r) => r.day_of_week), ...closedBySource]).size === 7;
}

export function facilityAsAnswer(i: FacilityMetaInput, today?: string): { facility: AnswerFacility; fallbacks: string[] } {
  const f = i.facility;
  const fallbacks: string[] = [];
  // A day calendar: the regular week read from the next four weeks, never this week's calendar; its holiday closures are closed days.
  const calendar = i.datedRows && i.datedRows.length > 0 && today ? regularWeekFromCalendar(i.datedRows, today) : null;
  const weekRows = calendar ? (calendar.week ?? []) : i.hoursRows;
  const grouped = groupHours(weekRows);
  let hours: FacilityHours[] | undefined = grouped.length > 0 ? grouped : undefined;
  const ownStale = i.hoursStale && i.hoursSource !== 'city-park-rule';
  if (hours && ownStale) { hours = undefined; fallbacks.push('own hours past the staleness threshold: no "Open" part'); }
  if (hours && i.hoursSource === 'city-park-rule') fallbacks.push('hours = the city\'s park rule ("City park hours" on the page)');
  const calendarUnclear = !!calendar && !calendar.week && !ownStale;
  if (calendar && calendar.week) fallbacks.push(`day calendar: regular week read from the next ${CALENDAR_WEEKS} weeks`);
  if (calendarUnclear) fallbacks.push(`day calendar: no regular week over the next ${CALENDAR_WEEKS} weeks: no "Open" part (title may say "Hours")`);
  const closedBySource = sourceClosedDays(f.hours_structured);
  const partWeek = !calendar && !!hours && !statesWholeWeek(i.hoursRows, closedBySource);
  if (partWeek) {
    hours = undefined;
    fallbacks.push(`hours state ${new Set(i.hoursRows.map((r) => r.day_of_week)).size} of 7 days: no "Open" part (title may say "Hours")`);
  } else if (hours && !calendar && !statesWholeWeek(i.hoursRows)) {
    fallbacks.push('a day without a row is closed in the source\'s own week (hours_structured) and on the page');
  }
  const hoursAsText = partWeek || calendarUnclear || (!hours && !ownStale && grouped.length === 0 && !!f.hours_text);
  if (hoursAsText && !partWeek && !calendarUnclear) fallbacks.push('hours only as the source\'s text: no "Open" part (title may say "Hours")');
  if (!hours && !hoursAsText && !ownStale) fallbacks.push('no hours: no "Open" part, title without "Hours"');
  const free = f.is_free === true && admissionRelevant(f.category);
  if (f.is_free === true && !free) fallbacks.push(`is_free on a ${f.category ?? 'uncategorised'} place: no "Free" (not an admission type)`);
  // The street as the page shows it: street_address, else the page's address when it names a street (it has a number), never a bare town.
  const street = f.street_address || (f.address && /\d/.test(f.address) ? f.address : null);
  if (!f.street_address && street) fallbacks.push('street from the page\'s address line (no street_address)');
  if (!street) fallbacks.push('no street address: name only, title without "Address"');
  const own = firstSentence(f.description);
  return {
    facility: {
      // Day groups with semicolons (owner order 2026-11-26 (16) 3): "Mon–Thu, Sat 10 AM–5 PM; Fri, Sun 11 AM–5 PM".
      name: f.name, place: f.name, street: street ?? undefined, rules: false, hours, hoursAsText, hoursJoin: '; ', phone: !!f.phone,
      cost: free ? { label: 'Free' } : undefined,
      closed: [
        ...i.exceptions.filter((e) => e.opens === null && e.closes === null).map((e) => e.date),
        ...(calendar?.closedDates ?? []),
      ].sort().map((date) => ({ date, text: date })),
      // The page's own description first (what only this page says), then the list of what is on it.
      tailOptions: [own, ...onPageLines(i)].filter((t): t is string => !!t),
    },
    fallbacks,
  };
}

/** The page's title and meta, with the fallbacks used. `today` is the town's date; its year is the title's. A page in HANDWRITTEN_META
 *  (`townId` + `slug`) gets that meta; its title is still built from the data. */
export function facilityPageMeta(
  i: FacilityMetaInput, o: { town: string; today: string; country: 'us' | 'gb'; townId?: string; slug?: string },
): { title: string; description: string; fallbacks: string[] } {
  const { facility, fallbacks } = facilityAsAnswer(i, o.today);
  const title = facilityTitle(facility, o.town, o.today.slice(0, 4));
  const handwritten = o.townId && o.slug ? HANDWRITTEN_META[o.townId]?.[o.slug] : undefined;
  if (handwritten) return { title, description: handwritten, fallbacks: [...fallbacks, 'handwritten meta (owner order 2026-11-26 (15))'] };
  return { title, description: facilityMeta(facility, o.today, o.country), fallbacks };
}
