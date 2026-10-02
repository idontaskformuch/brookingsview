import { describe, expect, it } from 'vitest';
import { isAiWrittenContent, CONTENT_TRACK_TYPES } from './db';

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
