import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isAiWrittenContent, CONTENT_TRACK_TYPES, countdown, formatShortMonthDay, titleTagForStory,
  type SourceType,
} from './db';

const CHI = 'America/Chicago';

describe('isAiWrittenContent', () => {
  it('is true for every Content Track type (reviews/recipes/editorials/columns)', () => {
    for (const sourceType of CONTENT_TRACK_TYPES) {
      expect(isAiWrittenContent(sourceType)).toBe(true);
    }
  });

  it('is false for scraped/derived types that are not AI-written prose', () => {
    expect(isAiWrittenContent('event')).toBe(false);
    expect(isAiWrittenContent('meeting')).toBe(false);
    expect(isAiWrittenContent('alert')).toBe(false);
  });

  it('is false for digest types outside the daily Content Track rotation', () => {
    // home_sales_digest/sports_digest are generated on their own cadence,
    // not part of CONTENT_TRACK_TYPES -- see that constant's own comment.
    expect(isAiWrittenContent('home_sales_digest')).toBe(false);
    expect(isAiWrittenContent('sports_digest')).toBe(false);
  });
});

describe('countdown (item B3: town-local calendar days, not raw elapsed time)', () => {
  it('returns "today" for a game later THIS SAME local day, even just after local midnight', () => {
    // The real bug this fix closes: at 00:30 CDT, a 7pm CDT start the same
    // local day is ~18.5 real hours away -- the old Math.ceil(hours/24)
    // implementation rounded that up to 1 ("tomorrow"), which is wrong: it's
    // today. 2026-08-27T05:30:00Z = 00:30 CDT; 2026-08-28T00:00:00Z = 7pm
    // CDT Aug 27 (same local day as `now`).
    const now = new Date('2026-08-27T05:30:00Z');
    expect(countdown('2026-08-28T00:00:00Z', now, CHI)).toBe('today');
  });

  it('returns "today" for a start time earlier than `now` the same local day', () => {
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-27T15:00:00Z', now, CHI)).toBe('today');
  });

  it('returns "tomorrow" for the very next town-local calendar day', () => {
    // now = 2026-08-27T19:00:00Z = 2pm CDT Aug 27; target = 7pm CDT Aug 28.
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-29T00:00:00Z', now, CHI)).toBe('tomorrow');
  });

  it('returns "in N days" for a game further out, counted in local calendar days', () => {
    const now = new Date('2026-08-27T19:00:00Z'); // 2pm CDT Aug 27
    expect(countdown('2026-09-01T00:00:00Z', now, CHI)).toBe('in 4 days'); // 7pm CDT Aug 31
  });

  it('is timezone-aware, not UTC -- the same instant counts differently in a different town timezone', () => {
    // 2026-08-28T05:00:00Z is midnight CDT at the START of Aug 28 (Chicago)
    // but still 10pm PDT on Aug 27 (Los Angeles) -- a real cross-midnight
    // divergence between towns for the identical instant.
    const now = new Date('2026-08-27T19:00:00Z');
    expect(countdown('2026-08-28T05:00:00Z', now, CHI)).toBe('tomorrow');
    expect(countdown('2026-08-28T05:00:00Z', now, 'America/Los_Angeles')).toBe('today');
  });

  it('returns an empty string for a null value', () => {
    expect(countdown(null, new Date(), CHI)).toBe('');
  });
});

// QA finding #5 (2026-10): formatShortMonthDay()/titleTagForStory() run
// against the module-scoped TZ constant (siteConfig.timezone), which
// falls back to America/Chicago (Brookings) when SITE_CITY is unset --
// see site-config.ts's own top comment -- same as this file's build
// environment during `vitest run`.
describe('formatShortMonthDay', () => {
  it('formats a UTC instant as a short month+day in the town timezone, no year or weekday', () => {
    // 2026-10-17T15:00:00Z = 10am CDT -- same calendar day in Chicago.
    expect(formatShortMonthDay('2026-10-17T15:00:00Z')).toBe('Oct 17');
  });

  it('returns an empty string for null', () => {
    expect(formatShortMonthDay(null)).toBe('');
  });
});

describe('titleTagForStory', () => {
  function story(overrides: Partial<{ title: string; source_type: SourceType; occurs_at: string | null }>) {
    return { title: 'Community Art Day', source_type: 'event' as SourceType, occurs_at: '2026-10-17T15:00:00Z', ...overrides };
  }

  it('appends the short date for an event with occurs_at', () => {
    expect(titleTagForStory(story({}))).toBe('Community Art Day — Oct 17');
  });

  it('appends the short date for an alert with occurs_at', () => {
    expect(titleTagForStory(story({ source_type: 'alert', title: 'Extreme Heat Warning' })))
      .toBe('Extreme Heat Warning — Oct 17');
  });

  it('returns the bare title for an event/alert with no occurs_at, rather than a dangling separator', () => {
    expect(titleTagForStory(story({ occurs_at: null }))).toBe('Community Art Day');
  });

  it('never appends a date for a meeting -- build_title() already bakes one in', () => {
    expect(titleTagForStory(story({ source_type: 'meeting', title: 'City Council Regular Meeting — Tue, Oct 13' })))
      .toBe('City Council Regular Meeting — Tue, Oct 13');
  });

  it('never appends a date for any other source_type (weekly, recipe, etc.)', () => {
    expect(titleTagForStory(story({ source_type: 'weekly' }))).toBe('Community Art Day');
  });
});

describe('every reader-facing stories listing excludes superseded rows', () => {
  // db.ts's SQL functions call the live Neon connection (sql = neon(...) at
  // module scope) -- no mocking seam exists for them in this codebase (see
  // this file's other describe blocks: only pure exports get unit tests),
  // so this is a source-text regression guard, not an execution test: it
  // reads db.ts itself and asserts each listing function's own SQL block
  // still carries `AND superseded_by_slug IS NULL`. Real bug this guards
  // against: a duplicate meeting story (two `meetings` rows for the same
  // real eSCRIBE meeting under different content_hashes, see .claude/
  // state.md's "meeting 12940/13790") rendered twice on the homepage,
  // /city-hall/archive, and elsewhere until each listing query got this
  // filter -- a future listing function that forgets it would reintroduce
  // the same bug silently.
  //
  // getStoryBySlug/getAllStories are DELIBERATELY excluded -- see
  // getAllStories()'s own doc comment and rss.xml.ts's: getStaticPaths
  // needs every row (including superseded ones) to keep building a page
  // for every url that's ever been indexed, so an old URL degrades via the
  // worker-level 301 redirect rather than a hard 404. getActiveAlerts is
  // excluded too -- it's hard-filtered to source_type = 'alert', a type
  // this flag is never set on.
  const dbSourcePath = fileURLToPath(new URL('./db.ts', import.meta.url));
  const dbSource = readFileSync(dbSourcePath, 'utf-8');

  const LISTING_FUNCTIONS = [
    'getWorthKnowingCandidates', 'getLatestFromCandidates', 'getRecentCompactContent',
    'getPastStories', 'getTodaysFeature', 'getContentByType', 'getStoriesForNewsSitemap',
    'getLatestWeekly', 'getAllWeeklyStories', 'getStoriesForWeekly',
    'getWorthKnowingCandidatesInRange', 'getRelatedStories', 'getSignData', 'getUpcomingStories',
  ];

  it.each(LISTING_FUNCTIONS)('%s filters superseded_by_slug in every one of its SQL blocks', (fnName) => {
    const start = dbSource.indexOf(`function ${fnName}(`);
    expect(start, `${fnName} not found in db.ts`).toBeGreaterThan(-1);
    // Slice to the next top-level `export async function` / `export function`
    // (or EOF) so a function with multiple SELECTs (getLatestWeekly,
    // getRelatedStories) gets ALL of them checked, not just the first.
    const rest = dbSource.slice(start + 1);
    const nextFn = rest.search(/\nexport (async )?function /);
    const body = nextFn === -1 ? rest : rest.slice(0, nextFn);
    const selectBlocks = body.split(/\bFROM stories\b/).slice(1);
    expect(selectBlocks.length, `${fnName} has no FROM stories query`).toBeGreaterThan(0);
    for (const block of selectBlocks) {
      // The filter must appear before the closing of THIS query (the next
      // `` ` `` that ends the tagged template), not just anywhere later in
      // the function body (which would pass even if a LATER query has it
      // but an earlier one doesn't).
      const queryEnd = block.indexOf('`');
      const query = queryEnd === -1 ? block : block.slice(0, queryEnd);
      expect(query, `a FROM stories block in ${fnName} is missing the filter`).toContain('superseded_by_slug IS NULL');
    }
  });

  it('getStoryBySlug and getAllStories are deliberately NOT in the list above', () => {
    expect(LISTING_FUNCTIONS).not.toContain('getStoryBySlug');
    expect(LISTING_FUNCTIONS).not.toContain('getAllStories');
  });

  // getMeetingDecisions orders by event_item_id, a Legistar-only id that is
  // NULL for a non-Legistar row (db/migrations/055_meeting_decisions_source
  // _system.sql). Without NULLS LAST, Postgres' default NULL-sort-last
  // behavior for ASC is still correct for a single mixed query, but a
  // future edit that drops it (e.g. switching to a plain column sort
  // without rechecking NULL semantics) would make ordering among a non-
  // Legistar meeting's own all-NULL rows nondeterministic. Source-text
  // guard, same reasoning as the block above -- no DB mocking seam exists.
  it('getMeetingDecisions sorts event_item_id with NULLS LAST and a deterministic tiebreak', () => {
    const start = dbSource.indexOf('function getMeetingDecisions(');
    expect(start).toBeGreaterThan(-1);
    const rest = dbSource.slice(start + 1);
    const nextFn = rest.search(/\nexport (async )?function /);
    const body = nextFn === -1 ? rest : rest.slice(0, nextFn);
    expect(body).toContain('ORDER BY event_item_id ASC NULLS LAST, id ASC');
  });

  // QA finding #2 (2026-10): a story with occurs_at IS NULL used to be
  // unconditionally eligible for "Worth knowing" forever (no -24h floor
  // applied at all), which kept 3-3.5-month-old meeting stories on the
  // Brookings homepage. Source-text guard, same reasoning as the blocks
  // above -- this function hits the live Neon connection, no mocking seam.
  it('getWorthKnowingCandidates ages an occurs_at IS NULL row out by published_at, not forever', () => {
    const start = dbSource.indexOf('function getWorthKnowingCandidates(');
    expect(start).toBeGreaterThan(-1);
    const rest = dbSource.slice(start + 1);
    const nextFn = rest.search(/\nexport (async )?function /);
    const body = nextFn === -1 ? rest : rest.slice(0, nextFn);
    // A bare `occurs_at IS NULL` disjunct with no accompanying age check
    // would reintroduce the bug -- it must only appear paired with a
    // published_at floor.
    expect(body).not.toMatch(/OR occurs_at IS NULL OR/);
    expect(body).toContain("(occurs_at IS NULL AND published_at >= now() - interval '24 hours')");
  });
});
