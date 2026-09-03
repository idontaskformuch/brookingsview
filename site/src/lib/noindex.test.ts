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
  it('does not noindex a substantial editorial', () => {
    expect(shouldNoindexStory({ source_type: 'editorial', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial culture essay', () => {
    expect(shouldNoindexStory({ source_type: 'culture_essay', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial recipe', () => {
    expect(shouldNoindexStory({ source_type: 'vardagsmiddag', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial weekly roundup', () => {
    expect(shouldNoindexStory({ source_type: 'weekly', body: longBody(500) })).toBe(false);
  });
  it('does not noindex a substantial home-sales monthly digest', () => {
    expect(shouldNoindexStory({ source_type: 'home_sales_digest', body: longBody(500) })).toBe(false);
  });

  it('word-count safety net catches a thin editorial regardless of type', () => {
    expect(shouldNoindexStory({ source_type: 'editorial', body: longBody(10) })).toBe(true);
  });
  it('a thin meeting stays noindexed (already true by type) but is not double-tallied', () => {
    expect(shouldNoindexStory({ source_type: 'meeting', body: longBody(10) })).toBe(true);
    expect(getWordCountNoindexTally()).toBe(0);
  });
  it('tallies only the safety-net hits, not the expected source_type hits', () => {
    shouldNoindexStory({ source_type: 'meeting', body: longBody(500) }); // not tallied (type-based)
    shouldNoindexStory({ source_type: 'editorial', body: longBody(500) }); // not noindexed, not tallied
    shouldNoindexStory({ source_type: 'editorial', body: longBody(10) }); // tallied (safety net)
    shouldNoindexStory({ source_type: 'vardagsmiddag', body: longBody(5) }); // tallied (safety net)
    expect(getWordCountNoindexTally()).toBe(2);
  });
  it('exactly at the threshold stays indexable (>= threshold, not >)', () => {
    expect(shouldNoindexStory({ source_type: 'editorial', body: longBody(THIN_CONTENT_WORD_THRESHOLD) })).toBe(false);
  });
  it('one word under the threshold gets noindexed', () => {
    expect(shouldNoindexStory({ source_type: 'editorial', body: longBody(THIN_CONTENT_WORD_THRESHOLD - 1) })).toBe(true);
  });

  it('THIN_SCRAPED_SOURCE_TYPES contains exactly the four scraped-feed types', () => {
    const expected: SourceType[] = ['meeting', 'meeting_followup', 'event', 'alert'];
    expect([...THIN_SCRAPED_SOURCE_TYPES].sort()).toEqual([...expected].sort());
  });

  it('noindexes an otherwise-substantial story whose published_at was reset to null (unpublished)', () => {
    expect(shouldNoindexStory({ source_type: 'culture_essay', body: longBody(500), published_at: null })).toBe(true);
  });
  it('does not noindex a substantial story with a real published_at', () => {
    expect(shouldNoindexStory({
      source_type: 'culture_essay', body: longBody(500), published_at: '2026-08-01T00:00:00Z',
    })).toBe(false);
  });
  it('does not treat a test fixture that omits published_at as unpublished', () => {
    expect(shouldNoindexStory({ source_type: 'culture_essay', body: longBody(500) })).toBe(false);
  });
  it('does not tally the word-count counter for an unpublished-only noindex', () => {
    shouldNoindexStory({ source_type: 'culture_essay', body: longBody(500), published_at: null });
    expect(getWordCountNoindexTally()).toBe(0);
  });
});
