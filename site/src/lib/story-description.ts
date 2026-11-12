/** The meta description of a /s/ page whose story text is withheld (publicBody() is '': model-written rows, meta-only template
 *  bodies that only repeat title + place). Built from facts the page already shows -- title, the town's local day, the place --
 *  never from model text (2026-11-12: these pages shipped <meta name="description" content>; QA build.meta-missing).
 *
 *  "<title> at <venue>, <day>." -- a part that is missing is left out with its separator, a day the title already names is not
 *  repeated. The day is formatWeekdayDate() (the town's country), the form meeting titles carry. A title ending in "?" or "!"
 *  keeps it and the rest is its own sentence: "<title>? At <venue>, <day>.". A recurring series whose date line is the
 *  "Regular · Sat" kicker gets that kicker's pattern ("every Saturday"), never one occurrence's date, and a page with no date
 *  line gets no day (QA build.description-day).
 *  Over DESCRIPTION_CAP the venue shrinks to its name (the part before the first comma: Moreno's venue_raw carries the full
 *  street address), and only then is the text cut at a word boundary. */
import { meetingDayParts } from './meeting-day.mjs';
import { formatWeekdayDate } from './country-profile';
import { seriesPattern, type SeriesPattern } from './time';
import type { CountryId } from './country-profile';

export const DESCRIPTION_CAP = 155;

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
/** "Nov 17", "November 17", "17 Nov", "17th November" -- the title already says which day. */
const TITLE_HAS_DAY = new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b|\\b\\d{1,2}(st|nd|rd|th)?\\s+${MONTH}`, 'i');
/** A place that reads as a manner, not a location: "By video conference", "Online". */
const NOT_A_LOCATION = /^(by|via|online|virtual|remote)\b/i;

const MEETING_TYPES = new Set(['meeting', 'meeting_followup']);

export interface StoryFacts {
  title: string;
  source_type: string;
  occurs_at: string | Date | null;
  venue_raw?: string | null;
  meta?: { venue?: string; recurrence?: string } | null;
}

/** What the page's date line (story__when) shows: one day, the series kicker, or nothing a day could be checked against
 *  (bylined content: "Covering September 2024" on a home-sales digest whose occurs_at is the month's UTC first). */
export type DateLine = 'date' | 'series' | 'none';

/** "every Saturday" for the kicker's pattern ("Weekly · Sat"). "Regular" (recurrence not recognised) claims no cadence. */
export function seriesPhrase(p: SeriesPattern): string {
  switch (p.kind) {
    case 'every-n-weeks': return `every ${p.weeks} weeks on ${p.weekday}`;
    case 'weekly': return `every ${p.weekday}`;
    case 'daily': return 'daily';
    case 'monthly': return `monthly on a ${p.weekday}`;
    default: return `regularly on ${p.weekday}s`;
  }
}

/** Cut at the last word boundary at or before `cap`, with "…"; text that fits is returned unchanged. */
export function capAtWord(text: string, cap: number = DESCRIPTION_CAP): string {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

export function factsDescription(
  story: StoryFacts,
  opts: { timezone: string; meetingsHaveTime: boolean; country: CountryId; dateLine?: DateLine },
): string {
  const title = story.title.trim().replace(/[.]+$/, '').replace(/([?!])[?!.]*$/, '$1');
  const marked = /[?!]$/.test(title);
  const venue = (story.meta?.venue ?? story.venue_raw ?? '').trim().replace(/[.,;]+$/, '');
  const dateLine = opts.dateLine ?? 'date';
  let when = '';
  if (dateLine === 'series' && story.occurs_at) {
    // The page's date line is seriesKicker() of the same fields (formatOccursAt): the pattern, not this occurrence's date.
    when = seriesPhrase(seriesPattern(story.meta?.recurrence, story.occurs_at, opts.timezone));
  } else if (dateLine === 'date' && story.occurs_at && !TITLE_HAS_DAY.test(title)) {
    const parts = meetingDayParts(story.occurs_at, opts.timezone, MEETING_TYPES.has(story.source_type) ? opts.meetingsHaveTime : true);
    if (parts) when = formatWeekdayDate(parts, opts.country);
  }

  const build = (place: string) => {
    const rest: string[] = [];
    if (place && !title.toLowerCase().includes(place.toLowerCase())) {
      rest.push(NOT_A_LOCATION.test(place) ? `${place[0].toLowerCase()}${place.slice(1)}` : `at ${place}`);
    }
    if (when) rest.push(when);
    if (marked) {
      // "Game On!" keeps its "!", and the place is a sentence of its own after it.
      if (!rest.length) return title;
      const tail = rest.join(', ');
      return `${title} ${tail[0].toUpperCase()}${tail.slice(1)}.`;
    }
    const [first, ...more] = rest;
    if (!first) return `${title}.`;
    const lead = first.startsWith('at ') ? ` ${first}` : `, ${first}`;
    return `${title}${lead}${more.map((m) => `, ${m}`).join('')}.`;
  };
  const full = build(venue);
  if (full.length <= DESCRIPTION_CAP) return full;
  return capAtWord(build(venue.split(',')[0].trim()));
}
