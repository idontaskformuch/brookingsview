/** Phase 4, "Add to calendar" (2026-10-09): one standards-compliant .ics
 *  VEVENT per upcoming event, built from structured fields only -- no AI
 *  text goes into a calendar entry.
 *
 *  Pulled out of the `.ics.ts` endpoint into a plain function, same
 *  reasoning as buildEventJsonLd() in lib/event-jsonld.ts: unit-testable
 *  independent of Astro's build pipeline.
 *
 *  Timezone approach: every DTSTART/DTEND/DTSTAMP is emitted in UTC
 *  ("...Z" form), never a floating local time with a TZID/VTIMEZONE block.
 *  `occurs_at`/`ends_at` are already UTC timestamptz values out of
 *  Postgres -- formatting them as UTC performs ZERO timezone math, so
 *  there's no DST-transition computation to get wrong (the spec's own
 *  "no new date math" rule, applied here). A calendar client converts a
 *  UTC instant to the viewer's own local time automatically, which is the
 *  actually-correct behavior for someone adding a Brookings event to a
 *  calendar from anywhere else -- a VTIMEZONE block would be strictly
 *  worse here, not just more complex.
 *
 *  True all-day (DATE-only, no time-of-day) events don't exist in this
 *  data model -- every `events` row's occurs_at is a specific instant, so
 *  DTSTART is always DATE-TIME. If that ever changes, VALUE=DATE support
 *  would need to be added here deliberately, not assumed to already work.
 */
import { buildVenueIndex, resolveVenue, hasResolvedAddress, type Facility } from './db';

export interface IcsEventStory {
  slug: string;
  title: string;
  body: string;
  occurs_at: string | null;
  ends_at?: string | null;
  venue_raw?: string | null;
  is_recurring_series?: boolean;
  source_url?: string | null;
}

export interface IcsSite {
  siteName: string;
  domain: string;
}

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and a
 *  literal newline all need escaping (order matters -- backslash first,
 *  or escaping ';'/',' would double-escape the backslashes just added). */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** A UTC timestamptz ISO string -> iCal UTC DATE-TIME form ("Z" suffix,
 *  no punctuation) -- e.g. "2026-10-15T23:00:00.000Z" -> "20261015T230000Z". */
export function toIcsUtc(isoUtc: string): string {
  return new Date(isoUtc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 5545 §3.1: a content line MUST NOT exceed 75 octets (UTF-8 bytes,
 *  not JS chars), excluding the line break; longer lines fold onto a CRLF
 *  + a single leading space. Iterates by Unicode code point (not UTF-16
 *  code unit) so a surrogate pair is never split across the fold. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      segments.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // continuation lines also carry the mandatory leading space, which counts toward the 75-octet limit
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) segments.push(current);
  return segments.join('\r\n ');
}

/** Returns the full .ics file text, or null if this story shouldn't get
 *  one at all (not a real single-instant event -- a recurring-series page
 *  represents many future occurrences, the same reason it skips Event
 *  JSON-LD in lib/event-jsonld.ts). */
export function buildIcsEvent(
  story: IcsEventStory, facilities: Facility[], site: IcsSite, pageUrl: string,
): string | null {
  if (!story.occurs_at || story.is_recurring_series) return null;

  const venueIndex = buildVenueIndex(facilities);
  const resolvedVenue = resolveVenue(venueIndex, story.venue_raw);
  const locationParts: string[] = [];
  if (resolvedVenue) {
    locationParts.push(resolvedVenue.name);
    if (hasResolvedAddress(resolvedVenue) && resolvedVenue.address) locationParts.push(resolvedVenue.address);
  } else if (story.venue_raw) {
    locationParts.push(story.venue_raw);
  }
  const location = locationParts.join(', ');

  const descriptionText = story.source_url ? `${story.body}\n\nSource: ${story.source_url}` : story.body;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${site.siteName}//Event Calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${story.slug}@${site.domain}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(story.occurs_at)}`,
    ...(story.ends_at ? [`DTEND:${toIcsUtc(story.ends_at)}`] : []),
    `SUMMARY:${escapeIcsText(story.title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    `DESCRIPTION:${escapeIcsText(descriptionText)}`,
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
