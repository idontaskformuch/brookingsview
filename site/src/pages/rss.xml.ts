import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllStories } from '../lib/db';
import { siteConfig } from '../lib/site-config';

// Genererad vid build, precis som resten av sajten. Ingen story äldre än
// occurs_at behöver filtreras bort här -- ett RSS-arkiv får gärna vara fullt.
//
// getAllStories() is intentionally unfiltered (it also feeds getStaticPaths,
// which must keep building a page for every row so an already-indexed,
// since-unpublished story degrades to noindex rather than a hard 404 -- see
// lib/noindex.ts's published_at check). RSS has no such constraint: a feed
// reader has no use for a row with published_at = NULL, and confirmed live
// 2026-09-03 that unfiltered stories here were syndicating exactly the
// contamination-quarantine rows from NEEDS-HUMAN-REVIEW.md.
export async function GET(context: APIContext) {
  const stories = (await getAllStories()).filter((story) => story.published_at !== null);
  return rss({
    title: siteConfig.siteName,
    description: `What's happening in ${siteConfig.cityName}, ${siteConfig.stateName}.`,
    site: context.site!,
    items: stories.map((story) => ({
      title: story.title,
      description: story.body,
      link: `/s/${story.slug}/`,
      pubDate: new Date(story.published_at),
    })),
  });
}
