import { describe, expect, it } from 'vitest';
import { capAtWord, factsDescription, seriesPhrase, DESCRIPTION_CAP } from './story-description';
import { seriesKicker, seriesPattern } from './time';

// Every fixture is a real stories row (town + slug in the comment), fields copied as stored (CLAUDE.md rule 15).
const GLASGOW = { timezone: 'Europe/London', meetingsHaveTime: true, country: 'gb' as const };
const MORENO = { timezone: 'America/Los_Angeles', meetingsHaveTime: true, country: 'us' as const };
const BROOKINGS = { timezone: 'America/Chicago', meetingsHaveTime: false, country: 'us' as const };

describe('factsDescription (QA build.meta-missing, build.description-day, 2026-11-12)', () => {
  it('Glasgow meeting: the title names the day, the place is a manner', () => {
    // glasgow meeting-2026-11-17-15046
    expect(factsDescription({
      title: 'Baillieston Area Partnership — Tue 17 Nov 2026', source_type: 'meeting',
      occurs_at: '2026-11-17T10:00:00Z', meta: { venue: 'By video conference' },
    }, GLASGOW)).toBe('Baillieston Area Partnership — Tue 17 Nov 2026, by video conference.');
  });

  it('Glasgow event: title at venue, local day in the form meeting titles use', () => {
    // glasgow event-331533 (events 331533: "Sunday 15th Nov 2026 7:00pm")
    expect(factsDescription({
      title: 'Bonnie "Prince" Billy', source_type: 'event', occurs_at: '2026-11-15T19:00:00Z', meta: { venue: 'Old Fruitmarket' },
    }, GLASGOW)).toBe('Bonnie "Prince" Billy at Old Fruitmarket, Sun 15 Nov 2026.');
  });

  it('a title ending in "?" or "!" keeps it, and the place is its own sentence', () => {
    // glasgow event-331530
    expect(factsDescription({
      title: 'Mitchell Detectives: can you solve the mystery?', source_type: 'event', occurs_at: '2026-11-14T00:00:00Z',
      venue_raw: 'Mitchell Library', meta: { venue: 'Mitchell Library' },
    }, GLASGOW)).toBe('Mitchell Detectives: can you solve the mystery? At Mitchell Library, Sat 14 Nov 2026.');
    // moreno_valley_ca event-185183: 01:00Z is the evening before in Moreno Valley; over the cap the venue shrinks to its name
    expect(factsDescription({
      title: 'Moreno Valley: MV MALL Library: Game On!', source_type: 'event', occurs_at: '2026-12-19T01:00:00Z',
      venue_raw: 'Moreno Valley Public Library Iris Plaza Branch,16170 Perris Blvd Suite C3, Moreno Valley, CA 92551', meta: null,
    }, MORENO)).toBe('Moreno Valley: MV MALL Library: Game On! At Moreno Valley Public Library Iris Plaza Branch, Fri, Dec 18, 2026.');
  });

  it('a venue whose name the title carries is left out with its street address (QA build.description-venue)', () => {
    // moreno_valley_ca event-163864: 02:00Z is 6pm the evening before in Moreno Valley
    expect(factsDescription({
      title: 'Moreno Valley: MAIN LIBRARY: Pijama y Cuentos ~ Pajamas & Stories', source_type: 'event',
      occurs_at: '2026-12-17T02:00:00Z', venue_raw: 'Main Library,25480 Alessandro Blvd, Moreno Valley, CA 92553, USA', meta: null,
    }, MORENO)).toBe('Moreno Valley: MAIN LIBRARY: Pijama y Cuentos ~ Pajamas & Stories, Wed, Dec 16, 2026.');
  });

  it('a missing place or day is left out with its separator, never a dangling comma', () => {
    // brookings_sd event-316626: no venue (23:30Z = 5:30pm CST, same day)
    expect(factsDescription({
      title: 'America in Art: Curious Music Collective', source_type: 'event', occurs_at: '2026-11-04T23:30:00Z', venue_raw: null, meta: null,
    }, BROOKINGS)).toBe('America in Art: Curious Music Collective, Wed, Nov 4, 2026.');
    // brookings_sd event-222: neither
    expect(factsDescription({
      title: 'Brookings County Highway Dept is performing shoulder work west of Sinai on 217th Street', source_type: 'event',
      occurs_at: null, venue_raw: null, meta: null,
    }, BROOKINGS)).toBe('Brookings County Highway Dept is performing shoulder work west of Sinai on 217th Street.');
    // brookings_sd event-29: no day, venue_raw only
    expect(factsDescription({
      title: 'Brookings: Color Changing Vinyl Cup Workshop', source_type: 'event', occurs_at: null, venue_raw: 'Brookings Public Library', meta: null,
    }, BROOKINGS)).toBe('Brookings: Color Changing Vinyl Cup Workshop at Brookings Public Library.');
  });

  it('a venue already in the title is not repeated', () => {
    // glasgow event-318263
    expect(factsDescription({
      title: 'Agatha Christie: A World of Mystery at the Mitchell Library', source_type: 'event', occurs_at: '2026-10-26T00:00:00Z',
      venue_raw: 'Mitchell Library', meta: { venue: 'Mitchell Library' },
    }, GLASGOW)).toBe('Agatha Christie: A World of Mystery at the Mitchell Library, Mon 26 Oct 2026.');
  });

  it('is cut at about 155 characters on a word boundary', () => {
    // brookings_sd meeting-2026-11-09-15138
    const title = "Notice: possible quorum — Brookings Regional Growth Alliance's Perspectives presentation and discussion panel about Data Centers to be held at the Dacotah Bank Center — Mon, Nov 9, 2026";
    const d = factsDescription({
      title, source_type: 'meeting', occurs_at: '2026-11-09T00:00:00Z', meta: { venue: 'Dacotah Bank Center, 824 32nd Avenue' },
    }, BROOKINGS);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_CAP);
    expect(d.endsWith('…')).toBe(true);
    expect(title.startsWith(d.slice(0, -1))).toBe(true);
    expect(d).not.toMatch(/[\s,]…$/);
  });

  it('over the cap the venue shrinks to its name before anything is cut (Moreno venue_raw carries the street address)', () => {
    // moreno_valley_ca event-267384
    expect(factsDescription({
      title: 'Moreno Valley: Free Food Giveaway (Every Sunday)', source_type: 'event', occurs_at: '2028-08-20T21:30:00Z',
      venue_raw: 'Building Up Lives Foundation (Suite A),23185 Hemlock Ave, Moreno Valley, CA 92557, USA',
    }, MORENO)).toBe('Moreno Valley: Free Food Giveaway (Every Sunday) at Building Up Lives Foundation (Suite A), Sun, Aug 20, 2028.');
  });

  it("a series names the kicker's pattern, never one occurrence's date", () => {
    // glasgow event-series-2e15f0f2497a5f8f as the page reads it: meta not _checked, so no recurrence -> "Regular · Sat 10:30am"
    const artClub = { title: 'Saturday Art Club', source_type: 'event', occurs_at: '2026-11-14T10:30:00Z', venue_raw: 'Gallery of Modern Art', meta: null };
    expect(factsDescription(artClub, { ...GLASGOW, dateLine: 'series' })).toBe('Saturday Art Club at Gallery of Modern Art, regularly on Saturdays.');
    // glasgow event-series-f2e66f781ff8ccfd with its stored recurrence (shown once validate_ai_meta has checked it)
    const boardGames = {
      title: 'Board Games More Games', source_type: 'event', occurs_at: '2026-11-17T18:00:00Z', venue_raw: 'Shettleston Library',
      meta: { venue: 'Shettleston Library', recurrence: 'Every week on Tuesday' },
    };
    expect(factsDescription(boardGames, { ...GLASGOW, dateLine: 'series' })).toBe('Board Games More Games at Shettleston Library, every Tuesday.');
    // the same fields drive the page's date line
    expect(seriesKicker(boardGames.meta.recurrence, boardGames.occurs_at, GLASGOW.timezone)).toBe('Weekly · Tue');
    expect(seriesPhrase(seriesPattern(null, artClub.occurs_at, GLASGOW.timezone))).toBe('regularly on Saturdays');
  });

  it('a page with no date line gets no day', () => {
    // moreno_valley_ca home-sales-digest-2024-09: occurs_at is the covered month's UTC first, the page says "Covering September
    // 2024"; read in Los Angeles it was "Saturday, Aug 31, 2024" (QA build.description-day, 2026-11-12)
    expect(factsDescription({
      title: 'Moreno Valley home sales: what sold in September 2024', source_type: 'home_sales_digest', occurs_at: '2024-09-01T00:00:00Z',
    }, { ...MORENO, dateLine: 'none' })).toBe('Moreno Valley home sales: what sold in September 2024.');
  });

  it('capAtWord leaves short text alone', () => {
    expect(capAtWord('Short.')).toBe('Short.');
  });
});
