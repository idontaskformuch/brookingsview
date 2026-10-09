import { describe, expect, it } from 'vitest';
import { escapeIcsText, toIcsUtc, foldIcsLine, buildIcsEvent, type IcsEventStory } from './ics';
import type { Facility } from './db';

function facility(overrides: Partial<Facility>): Facility {
  return {
    id: 0, slug: 'x', name: 'X', category: 'other', address: null, phone: null,
    website: null, hours_text: null, description: null, source_url: null,
    verified_date: null, aliases: [], street_address: null, postal_code: null,
    lat: null, lon: null, image_path: null, image_alt: null, name_aliases: [],
    image_attribution_text: null, image_attribution_url: null, image_needs_review: false,
    free_teaser: null, hours_structured: null, hours_needs_review: false,
    is_free: null, fee_note: null, accessibility_note: null, services: null,
    verification_method: null, hours_confidence: null,
    ...overrides,
  };
}

function icsStory(overrides: Partial<IcsEventStory>): IcsEventStory {
  return {
    slug: 'event-1', title: 'Untitled', body: 'Body text.', occurs_at: '2026-10-15T23:00:00.000Z',
    ends_at: null, venue_raw: null, is_recurring_series: false, source_url: null,
    ...overrides,
  };
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma, and newline, in that order', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeIcsText('Trivia Night at the Library')).toBe('Trivia Night at the Library');
  });

  it('handles CRLF and bare CR the same as a bare LF', () => {
    expect(escapeIcsText('a\r\nb\rc')).toBe('a\\nb\\nc');
  });
});

describe('toIcsUtc', () => {
  it('formats a UTC instant with no punctuation and a Z suffix', () => {
    expect(toIcsUtc('2026-10-15T23:00:00.000Z')).toBe('20261015T230000Z');
  });

  // DST-boundary check per town, all performed with ZERO local-timezone
  // math (toIcsUtc never looks at a town's timezone at all) -- these exist
  // to prove that design choice, not to exercise any conversion logic.
  it('is unaffected by the America/Chicago (Brookings) spring-forward boundary', () => {
    // 2026-03-08 07:00 UTC = 01:00 CST -> 03:00 CDT in Chicago (the skipped hour).
    expect(toIcsUtc('2026-03-08T07:00:00.000Z')).toBe('20260308T070000Z');
  });

  it('is unaffected by the America/Los_Angeles (Moreno Valley) fall-back boundary', () => {
    // 2026-11-01 09:00 UTC is within the repeated hour in Los Angeles.
    expect(toIcsUtc('2026-11-01T09:00:00.000Z')).toBe('20261101T090000Z');
  });

  it('is unaffected by the America/Denver (Broomfield) spring-forward boundary', () => {
    expect(toIcsUtc('2026-03-08T09:00:00.000Z')).toBe('20260308T090000Z');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line (<=75 octets) unchanged', () => {
    expect(foldIcsLine('SUMMARY:Short title')).toBe('SUMMARY:Short title');
  });

  it('folds a long line at 75 octets with a single leading space on the continuation', () => {
    const longValue = 'A'.repeat(100);
    const folded = foldIcsLine(`DESCRIPTION:${longValue}`);
    const physicalLines = folded.split('\r\n');
    expect(physicalLines.length).toBeGreaterThan(1);
    for (const line of physicalLines.slice(1)) expect(line.startsWith(' ')).toBe(true);
    // Unfolding (strip CRLF+space) must reconstruct the exact original.
    expect(physicalLines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(`DESCRIPTION:${longValue}`);
  });

  it('never splits a multi-byte UTF-8 character across a fold', () => {
    // em dash (—) is 3 bytes in UTF-8 -- repeat it past the 75-octet mark.
    const value = '—'.repeat(40);
    const folded = foldIcsLine(`DESCRIPTION:${value}`);
    for (const physicalLine of folded.split('\r\n')) {
      // A valid, non-replacement-character string round-trips through
      // encode/decode without changing -- a split surrogate or multi-byte
      // sequence would corrupt it.
      const bytes = new TextEncoder().encode(physicalLine);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(physicalLine);
    }
  });
});

describe('buildIcsEvent', () => {
  const facilities: Facility[] = [
    facility({
      slug: 'library', name: 'Brookings Public Library', aliases: ['brookings public library'],
      address: '515 3rd St, Brookings, SD 57006', street_address: '515 3rd St', postal_code: '57006',
    }),
  ];
  const site = { siteName: 'Brookings View', domain: 'brookingsview.com' };

  it('returns null for a recurring-series page (many future instances, not one date)', () => {
    expect(buildIcsEvent(icsStory({ is_recurring_series: true }), facilities, site, 'https://brookingsview.com/s/x/')).toBeNull();
  });

  it('returns null when occurs_at is missing', () => {
    expect(buildIcsEvent(icsStory({ occurs_at: null }), facilities, site, 'https://brookingsview.com/s/x/')).toBeNull();
  });

  it('builds a well-formed VCALENDAR/VEVENT with CRLF line endings', () => {
    const ics = buildIcsEvent(icsStory({}), facilities, site, 'https://brookingsview.com/s/event-1/')!;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('\r\nBEGIN:VEVENT\r\n');
    expect(ics).toContain('\r\nEND:VEVENT\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:event-1@brookingsview.com\r\n');
    expect(ics).toContain('DTSTART:20261015T230000Z\r\n');
    expect(ics).toContain('URL:https://brookingsview.com/s/event-1/\r\n');
  });

  it('includes DTEND when ends_at is set, omits it when not', () => {
    const withEnd = buildIcsEvent(icsStory({ ends_at: '2026-10-16T01:00:00.000Z' }), facilities, site, 'https://x/s/1/')!;
    expect(withEnd).toContain('DTEND:20261016T010000Z\r\n');
    const withoutEnd = buildIcsEvent(icsStory({}), facilities, site, 'https://x/s/1/')!;
    expect(withoutEnd).not.toContain('DTEND');
  });

  it('LOCATION uses the resolved facility name + address when venue_raw resolves', () => {
    const ics = buildIcsEvent(icsStory({ venue_raw: 'Brookings Public Library' }), facilities, site, 'https://x/s/1/')!;
    expect(ics).toContain('LOCATION:Brookings Public Library\\, 515 3rd St\\, Brookings\\, SD 57006\r\n');
  });

  it('LOCATION falls back to the raw venue text when it never resolved to a facility', () => {
    const ics = buildIcsEvent(icsStory({ venue_raw: 'Pasque, 400 Main Avenue, Brookings, SD, 57006' }), facilities, site, 'https://x/s/1/')!;
    expect(ics).toContain('LOCATION:Pasque\\, 400 Main Avenue\\, Brookings\\, SD\\, 57006\r\n');
  });

  it('omits LOCATION entirely when there is no venue at all (common for Brookings)', () => {
    const ics = buildIcsEvent(icsStory({ venue_raw: null }), facilities, site, 'https://x/s/1/')!;
    expect(ics).not.toContain('LOCATION');
  });

  it('DESCRIPTION includes the body and, when present, the source URL -- both escaped', () => {
    const ics = buildIcsEvent(
      icsStory({ body: 'Free event.', source_url: 'https://x.org/e;1' }),
      facilities, site, 'https://x/s/1/',
    )!;
    expect(ics).toContain('DESCRIPTION:Free event.\\n\\nSource: https://x.org/e\\;1\r\n');
  });

  it('SUMMARY escapes a comma in the title', () => {
    const ics = buildIcsEvent(icsStory({ title: 'Trivia, Tacos & Tunes' }), facilities, site, 'https://x/s/1/')!;
    expect(ics).toContain('SUMMARY:Trivia\\, Tacos & Tunes\r\n');
  });

  it('builds correctly for all three real towns (UID domain differs, nothing else does)', () => {
    const sites = [
      { siteName: 'Brookings View', domain: 'brookingsview.com' },
      { siteName: 'Moreno Valley View', domain: 'morenovalleyview.com' },
      { siteName: 'Broomfield View', domain: 'broomfieldview.com' },
    ];
    for (const s of sites) {
      const ics = buildIcsEvent(icsStory({}), facilities, s, 'https://x/s/1/')!;
      expect(ics).toContain(`UID:event-1@${s.domain}\r\n`);
      expect(ics).toContain(`PRODID:-//${s.siteName}//Event Calendar//EN\r\n`);
    }
  });
});
