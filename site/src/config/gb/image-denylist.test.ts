import { describe, expect, it } from 'vitest';
import { DENIED_SOURCE_PHOTO_IDS, notDenied } from './image-denylist';
import { thisWeekImagesFor } from '../this-week-images';
import { GLASGOW_THIS_WEEK_IMAGES } from './glasgow-images';

describe('Glasgow image denylist (Q3 2026-10-28)', () => {
  it('both denied photos exist in the approved list and neither reaches the pool the pages draw from', () => {
    const denied = Object.keys(DENIED_SOURCE_PHOTO_IDS).map(Number);
    expect(GLASGOW_THIS_WEEK_IMAGES.filter((i) => denied.includes(i.sourcePhotoId as number))).toHaveLength(2);
    const pool = thisWeekImagesFor('glasgow');
    expect(pool.some((i) => denied.includes((i as { sourcePhotoId?: number }).sourcePhotoId as number))).toBe(false);
  });
  it('an autumn photo is still left for Glasgow', () => {
    expect(thisWeekImagesFor('glasgow').filter((i) => i.seasons.includes('autumn')).length).toBeGreaterThanOrEqual(5);
  });
  it('notDenied keeps images without a source id', () => {
    expect(notDenied({})).toBe(true);
    expect(notDenied({ sourcePhotoId: 1155440286 })).toBe(false);
  });
});
