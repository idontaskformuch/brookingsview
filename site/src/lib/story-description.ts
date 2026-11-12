/** The meta description of a /s/ page whose story text is withheld (publicBody() is '': model-written rows, meta-only template
 *  bodies that only repeat title + place). Built from facts the page already shows -- title, the town's local day, the place --
 *  never from model text (2026-11-12: these pages shipped <meta name="description" content>; QA build.meta-missing).
 *
 *  "<title> at <venue>, <day>." -- a part that is missing is left out with its separator, a day the title already names is not
 *  repeated, and anything over DESCRIPTION_CAP is cut at a word boundary. */
import { meetingDayParts } from './meeting-day.mjs';
import { formatDayLong } from './holiday-calendar';

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
  meta?: { venue?: string } | null;
}

/** Cut at the last word boundary at or before `cap`, with "…"; text that fits is returned unchanged. */
export function capAtWord(text: string, cap: number = DESCRIPTION_CAP): string {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

export function factsDescription(
  story: StoryFacts, opts: { timezone: string; meetingsHaveTime: boolean; locale: 'en-US' | 'en-GB' },
): string {
  const title = story.title.trim().replace(/[.!?]+$/, '');
  const venue = (story.meta?.venue ?? story.venue_raw ?? '').trim().replace(/[.,;]+$/, '');
  const parts = MEETING_TYPES.has(story.source_type) || story.occurs_at
    ? meetingDayParts(story.occurs_at, opts.timezone, MEETING_TYPES.has(story.source_type) ? opts.meetingsHaveTime : true)
    : null;
  const day = parts && !TITLE_HAS_DAY.test(title) ? formatDayLong(Date.UTC(parts.y, parts.m - 1, parts.d), opts.locale) : '';

  let sentence = title;
  if (venue && !title.toLowerCase().includes(venue.toLowerCase())) {
    sentence += NOT_A_LOCATION.test(venue) ? `, ${venue[0].toLowerCase()}${venue.slice(1)}` : ` at ${venue}`;
  }
  if (day) sentence += `, ${day}`;
  return capAtWord(`${sentence}.`);
}
