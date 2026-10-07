import { describe, expect, it, beforeEach } from 'vitest';
import {
  shouldNoindexStory, countWords, getWordCountNoindexTally, resetWordCountNoindexTally,
  THIN_SCRAPED_SOURCE_TYPES, THIN_CONTENT_WORD_THRESHOLD,
} from './noindex';
import type { SourceType } from './db';

function longBody(words: number): string {
  return Array(words).fill('word').join(' ');
}

beforeEach(() => {
  resetWordCountNoindexTally();
});

describe('countWords', () => {
  it('counts space-separated words', () => {
    expect(countWords('one two three')).toBe(3);
  });
  it('collapses multiple whitespace/newlines', () => {
    expect(countWords('one\n\ntwo   three')).toBe(3);
  });
  it('treats an empty body as zero words', () => {
    expect(countWords('')).toBe(0);
  });
});

describe('shouldNoindexStory', () => {
  it('noindexes a substantial meeting story purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'meeting', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial event story purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'event', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial weather alert story purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'alert', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial meeting_followup story purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'meeting_followup', body: longBody(500) })).toBe(true);
  });

  // AdSense "low value content" remediation, Phase 0 (2026-10-07): the six
  // generic AI content-track types joined the scraped-feed types above --
  // every one of them now noindexes purely by source_type, same as a
  // meeting/event/alert, regardless of word count. Generation stopped and
  // every other surface was unlinked; this is what keeps the standalone
  // permalinks of already-published rows out of the index too.
  it('noindexes a substantial editorial purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'editorial', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial culture essay purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'culture_essay', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial quick essay (kvick_essa) purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'kvick_essa', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial science column (vetenskap_kronika) purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'vetenskap_kronika', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial media review purely for its source_type', () => {
    expect(shouldNoindexStory({ source_type: 'media_recension', body: longBody(500) })).toBe(true);
  });
  it('noindexes a substantial recipe purely for its source_type, even with real ingredients/instructions', () => {
    // Regression lock for the exact shape the pre-Phase-0 carve-out below
    // used to protect (thin intro body, substantial structured fields) --
    // the type-based rule now wins regardless, same as any other removed
    // content-track type.
    expect(shouldNoindexStory({
      source_type: 'vardagsmiddag',
      body: longBody(60),
      ingredients: Array(15).fill('2 tablespoons olive oil'),
      instructions: Array(12).fill('Heat the pan over medium heat and cook until everything turns golden brown all over.'),
    })).toBe(true);
  });

  it('does not noindex a substantial weekly roundup', () => {
    expect(shouldNoindexStory({ source_type: 'weekly', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial home-sales monthly digest', () => {
    expect(shouldNoindexStory({ source_type: 'home_sales_digest', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial Worker Pulse digest', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(500) })).toBe(false);
  });

  // workplace_watch_digest stands in for "a real, still-generating,
  // non-thin-by-type story" below -- editorial/culture_essay/vardagsmiddag
  // (used here before Phase 0) are no longer suitable for isolating the
  // word-count safety net from the type-based rule, since they're now
  // thin-by-type themselves.
  it('word-count safety net catches a thin digest regardless of type', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(10) })).toBe(true);
  });
  it('a thin meeting stays noindexed (already true by type) but is not double-tallied', () => {
    expect(shouldNoindexStory({ source_type: 'meeting', body: longBody(10) })).toBe(true);
    expect(getWordCountNoindexTally()).toBe(0);
  });
  it('tallies only the safety-net hits, not the expected source_type hits', () => {
    shouldNoindexStory({ source_type: 'meeting', body: longBody(500) }); // not tallied (type-based)
    shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(500) }); // not noindexed, not tallied
    shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(10) }); // tallied (safety net)
    shouldNoindexStory({ source_type: 'home_sales_digest', body: longBody(5) }); // tallied (safety net)
    expect(getWordCountNoindexTally()).toBe(2);
  });
  it('exactly at the threshold stays indexable (>= threshold, not >)', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(THIN_CONTENT_WORD_THRESHOLD) })).toBe(false);
  });
  it('one word under the threshold gets noindexed', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(THIN_CONTENT_WORD_THRESHOLD - 1) })).toBe(true);
  });

  it('THIN_SCRAPED_SOURCE_TYPES contains exactly the scraped-feed types plus the removed content track', () => {
    const expected: SourceType[] = [
      'meeting', 'meeting_followup', 'event', 'alert',
      'culture_essay', 'editorial', 'vetenskap_kronika', 'kvick_essa', 'media_recension', 'vardagsmiddag',
    ];
    expect([...THIN_SCRAPED_SOURCE_TYPES].sort()).toEqual([...expected].sort());
  });

  it('noindexes an otherwise-substantial story whose published_at was reset to null (unpublished)', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(500), published_at: null })).toBe(true);
  });
  it('does not noindex a substantial story with a real published_at', () => {
    expect(shouldNoindexStory({
      source_type: 'workplace_watch_digest', body: longBody(500), published_at: '2026-08-01T00:00:00Z',
    })).toBe(false);
  });
  it('does not treat a test fixture that omits published_at as unpublished', () => {
    expect(shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(500) })).toBe(false);
  });
  it('does not tally the word-count counter for an unpublished-only noindex', () => {
    shouldNoindexStory({ source_type: 'workplace_watch_digest', body: longBody(500), published_at: null });
    expect(getWordCountNoindexTally()).toBe(0);
  });

  // Recipe SEO handoff: the structured-field word-count fold-in was built
  // for vardagsmiddag's real shape (content/recept/vardagsmiddag.py extracts
  // ingredients/instructions OUT of body, leaving a short 2-4 sentence intro
  // by design) -- confirmed live, this was silently noindexing every real
  // recipe permalink before ingredients/instructions were folded into the
  // word count below. vardagsmiddag itself is now unconditionally
  // noindexed by type (Phase 0, see the regression-lock test above), so
  // these tests use a neutral, non-thin-by-type source_type instead to
  // keep exercising the underlying word-counting mechanism in isolation --
  // shouldNoindexStory() never actually special-cases by type for this
  // part, only for the THIN_SCRAPED_SOURCE_TYPES check.
  describe('structured-field word count (ingredients/instructions)', () => {
    it('does not noindex a thin intro body with substantial ingredients+instructions', () => {
      expect(shouldNoindexStory({
        source_type: 'weekly',
        body: longBody(60), // a realistic short intro, alone under the threshold
        ingredients: Array(15).fill('2 tablespoons olive oil'), // 15 * 4 = 60 words
        // 12 * 16 = 192 words -- 60 + 60 + 192 = 312, comfortably over the threshold
        instructions: Array(12).fill('Heat the pan over medium heat and cook until everything turns golden brown all over.'),
      })).toBe(false);
    });

    it('still noindexes a genuinely thin story (short body, no/thin ingredients+instructions)', () => {
      expect(shouldNoindexStory({
        source_type: 'weekly',
        body: longBody(10),
        ingredients: ['Salt'],
        instructions: ['Cook it.'],
      })).toBe(true);
    });

    it('treats missing ingredients/instructions as empty, not a crash', () => {
      expect(shouldNoindexStory({
        source_type: 'weekly', body: longBody(10), ingredients: null, instructions: null,
      })).toBe(true);
      expect(shouldNoindexStory({ source_type: 'weekly', body: longBody(500) })).toBe(false);
    });

    it('does not affect a story\'s word count when no ingredients/instructions fields are present', () => {
      expect(shouldNoindexStory({ source_type: 'weekly', body: longBody(500) })).toBe(false);
      expect(shouldNoindexStory({ source_type: 'weekly', body: longBody(10) })).toBe(true);
    });
  });
});
