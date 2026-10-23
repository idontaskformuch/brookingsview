import { describe, expect, it } from 'vitest';
import { teaser } from './teaser';

describe('teaser (list shows the start, the detail page shows the whole)', () => {
  it('returns short text untouched', () => {
    expect(teaser('Short summary.')).toBe('Short summary.');
  });
  it('cuts at the last sentence end that fits', () => {
    const s = 'The 114th Hobo Day parade runs from Medary Avenue to Downtown Brookings, starting at 9:30 a.m. Participants dress in hobo style and the route is lined with families. ' +
      'Floats, bands and clubs follow for about two hours before the football game at the stadium.';
    const t = teaser(s, 200);
    expect(t.endsWith('.')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(200);
    expect(s.startsWith(t)).toBe(true);
  });
  it('falls back to a word boundary and an ellipsis when no sentence ends in range', () => {
    const s = 'word '.repeat(80).trim();
    const t = teaser(s, 100);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(101);
    expect(t).not.toMatch(/wor…$/);
  });
  it('never ends on a dangling abbreviation-free fragment shorter than 60 characters of sentence', () => {
    const s = 'Hi. ' + 'x'.repeat(10) + ' and then a very long run of words without any further full stop at all in this sentence ' + 'y '.repeat(60);
    expect(teaser(s, 120).endsWith('…')).toBe(true);
  });
});
