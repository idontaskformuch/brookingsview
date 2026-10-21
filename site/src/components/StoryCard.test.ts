import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import StoryCard from './StoryCard.astro';
import type { Story } from '../lib/db';

function eventStory(over: Partial<Story> = {}): Story {
  return {
    id: 1, title: 'Story Time', slug: 'story-time', body: 'Stories for kids.', source_type: 'event',
    source_url: null, occurs_at: '2026-10-21T00:00:00Z', published_at: '2026-10-19T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
    ingredients: null, instructions: null, ...over,
  } as Story;
}

async function render(props: Record<string, unknown>) {
  const c = await AstroContainer.create();
  return c.renderToString(StoryCard, { props });
}

describe('event category labels are consistent', () => {
  it('a plain town event always carries the "Around Town" label', async () => {
    const html = await render({ story: eventStory() });
    expect(html).toContain('>Around Town<');
  });
  it('an arts item keeps its own label when one is passed', async () => {
    const html = await render({ story: eventStory(), kicker: 'Arts & Culture' });
    expect(html).toContain('Arts &amp; Culture');
    expect(html).not.toContain('>Around Town<');
  });
  it('shows the real month/day badge next to the label, not an emoji', async () => {
    const html = await render({ story: eventStory() });
    expect(html).toContain('date-badge');
    expect(html).toMatch(/date-badge__mon[^>]*>OCT</);
  });
});
