import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllStories, CONTENT_TRACK_TYPES } from '../lib/db';
import { siteConfig } from '../lib/site-config';
import { storyHref } from '../lib/content-slugs';
import { redactWorkerPulseBody } from '../lib/content-redaction';

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
//
// AdSense "low value content" remediation, Phase 0: CONTENT_TRACK_TYPES
// (the generic AI content track -- editorials/columns/reviews/recipes)
// also excluded here now -- generation stopped and the type was unlinked
// from every other surface, so a feed reader subscribed before this
// shouldn't keep getting old rows resurfaced forever either.
//
// Events correctness Phase 1: a superseded event (retroactively merged
// into a recurring-series story, see Story's own superseded_by_slug doc
// comment) is excluded the same way -- a feed reader doesn't need the old
// per-occurrence duplicate once there's a canonical series item for it.
export async function GET(context: APIContext) {
  const stories = (await getAllStories())
    .filter((story) =>
      story.published_at !== null
      && !CONTENT_TRACK_TYPES.includes(story.source_type)
      && !story.superseded_by_slug);
  return rss({
    title: siteConfig.siteName,
    description: `What's happening in ${siteConfig.cityName}, ${siteConfig.stateName}.`,
    site: context.site!,
    items: stories.map((story) => ({
      title: story.title,
      // 2026-10-02: redacted for workplace_watch_digest rows -- the raw
      // body routinely states a specific Glassdoor/Indeed rating in prose,
      // see lib/content-redaction.ts's own module docstring.
      description: redactWorkerPulseBody(story.source_type, story.body),
      link: storyHref(story.slug),
      pubDate: new Date(story.published_at),
    })),
  });
}
