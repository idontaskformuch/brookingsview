import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllStories } from '../lib/db';

// Genererad vid build, precis som resten av sajten. Ingen story äldre än
// occurs_at behöver filtreras bort här -- ett RSS-arkiv får gärna vara fullt.
export async function GET(context: APIContext) {
  const stories = await getAllStories();
  return rss({
    title: 'Brookings View',
    description: "What's happening in Brookings, South Dakota.",
    site: context.site!,
    items: stories.map((story) => ({
      title: story.title,
      description: story.body,
      link: `/s/${story.slug}/`,
      pubDate: new Date(story.published_at),
    })),
  });
}
