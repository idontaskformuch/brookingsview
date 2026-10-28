import { describe, expect, it, vi } from 'vitest';

// Glasgow: the Kids & family filter uses the story's own "Kids & families" tag, not the keyword guess US towns use.
vi.mock('./site-config', async (orig) => {
  const real = await orig<typeof import('./site-config')>();
  return { ...real, siteConfig: { ...real.siteConfig, country: 'gb' } };
});

import { isKidsEvent, type FeedItem } from './events';
import type { Story } from './db';

const item = (title: string, meta?: Story['meta']): FeedItem => ({
  sourceKind: 'story', occurs_at: null,
  story: { id: 1, title, slug: 's', body: 'A family history talk.', source_type: 'event', source_url: null, occurs_at: null,
    published_at: '2026-10-28T12:00:00Z', generated_by: 'ai', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null, meta } as Story,
});

describe('isKidsEvent on a gb town', () => {
  it('is true only with the Kids & families tag', () => {
    expect(isKidsEvent(item('Mini Museum Explorers', { category: 'Museums & exhibitions', tags: ['Kids & families'] }))).toBe(true);
  });
  it('ignores the word "family" in the title or body without the tag', () => {
    expect(isKidsEvent(item('Family history talk', { category: 'Libraries' }))).toBe(false);
    expect(isKidsEvent(item('Family history talk'))).toBe(false);
  });
});
