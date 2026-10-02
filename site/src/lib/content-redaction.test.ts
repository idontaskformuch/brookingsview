import { describe, expect, it } from 'vitest';
import { redactWorkerPulseBody } from './content-redaction';

const REAL_RATING_SENTENCE = (
  "Employees at Vail Resorts's Broomfield corporate office rate the company " +
  "2.9 out of 5 stars on Glassdoor, notably lower than the company-wide average of 3.3."
);

describe('redactWorkerPulseBody', () => {
  it('replaces a workplace_watch_digest body with the withheld-note placeholder', () => {
    const result = redactWorkerPulseBody('workplace_watch_digest', REAL_RATING_SENTENCE);
    expect(result).not.toContain('2.9');
    expect(result).not.toBe(REAL_RATING_SENTENCE);
    expect(result).toContain('withheld');
  });

  it('leaves every other source_type completely unchanged', () => {
    for (const sourceType of ['editorial', 'media_recension', 'culture_essay', 'meeting', 'event']) {
      expect(redactWorkerPulseBody(sourceType, REAL_RATING_SENTENCE)).toBe(REAL_RATING_SENTENCE);
    }
  });

  it('the placeholder itself never contains a star-rating-shaped number', () => {
    const result = redactWorkerPulseBody('workplace_watch_digest', REAL_RATING_SENTENCE);
    expect(result).not.toMatch(/\d\.\d\s*(out of 5|\/5|stars)/);
  });
});
