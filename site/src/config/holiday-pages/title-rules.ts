/** Holiday page titles (owner 2026-11-18, .claude/specs/us-christmas-2026.md "väg B"), every town and both page templates.
 *  The title is "<label> [<year>] in <Town>: <words>". Words come in this fixed priority, most important first: the page's big
 *  events when confirmed (HolidayPageData.titleTopics), then these section words. Over TITLE_OK_MAX characters, words are struck from
 *  the end (lowest priority first) until it fits; at least one word stays. Still over TITLE_WARN_MAX with one word left (or with no
 *  words and the prefix alone too long) = build error; between the two = build warning. */
import type { HolidaySection } from '../../lib/holiday-page';

export const TITLE_SECTION_PRIORITY: HolidaySection[] = ['closures', 'trash', 'transit', 'events', 'help'];
export const TITLE_OK_MAX = 65;
export const TITLE_WARN_MAX = 70;
