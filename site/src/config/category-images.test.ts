import { describe, expect, it } from 'vitest';
import { CATEGORY_IMAGES } from './category-images';

describe('category image pools', () => {
  it('every photo file belongs to its own town (no borrowing across towns)', () => {
    for (const [town, pools] of Object.entries(CATEGORY_IMAGES)) {
      for (const [category, images] of Object.entries(pools)) {
        if (category === 'movie_review') continue; // shared illustrations, not photos
        for (const img of images ?? []) {
          expect(img.path, `${town}/${category}`).toContain(`/${town}-`);
        }
      }
    }
  });

  it('no file path appears in two pools', () => {
    const seen = new Map<string, string>();
    for (const [town, pools] of Object.entries(CATEGORY_IMAGES)) {
      for (const [category, images] of Object.entries(pools)) {
        if (category === 'movie_review') continue;
        for (const img of images ?? []) {
          expect(seen.has(img.path), `${img.path} in ${town}/${category} and ${seen.get(img.path)}`).toBe(false);
          seen.set(img.path, `${town}/${category}`);
        }
      }
    }
  });

  it('Broomfield has its own pool for each section it renders a hero for', () => {
    for (const category of ['city_hall', 'events', 'jobs', 'traffic', 'workplace_watch', 'weather_alert'] as const) {
      expect(CATEGORY_IMAGES.broomfield_co[category]?.length ?? 0, category).toBeGreaterThanOrEqual(3);
    }
  });
});
