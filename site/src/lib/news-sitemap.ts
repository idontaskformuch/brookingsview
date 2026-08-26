/**
 * Google News sitemap -- a separate file from the general XML sitemap
 * (@astrojs/sitemap), rolling 48-hour window only. See NEEDS-HUMAN-REVIEW.md,
 * "Google News sitemap" for the full spec this implements.
 *
 * Pulled into a plain, dependency-free module (no Astro, no DB) for the
 * same reason as event-jsonld.ts/article-jsonld.ts: unit-testable, and
 * specifically so the brief's own explicit ask -- "verify the sitemap date,
 * the on-page date, and the schema datePublished all resolve to the exact
 * same instant" -- has one real, automated test instead of a one-time
 * manual check (see news-sitemap.test.ts).
 *
 * DATE DISCIPLINE: every date used here comes from `published_at` alone --
 * the same column that already backs the on-page timestamp (formatDate())
 * and NewsArticle's `datePublished` (buildArticleJsonLd()). One column, one
 * source of truth, three renderings -- never three independently-tracked
 * dates that could drift apart. `toZonedISOString()` (lib/db.ts) is reused
 * unchanged for the W3C-with-offset format Google's news:publication_date
 * spec calls for -- the exact function already proven correct for Event
 * JSON-LD's startDate/endDate.
 */
import { toZonedISOString, type Story } from './db';

export const NEWS_SITEMAP_WINDOW_HOURS = 48;

export interface NewsSitemapSite {
  siteUrl: string;
  /** Must exactly match the publication name as registered in Google
   *  Publisher Center -- no trailing parentheticals (see the brief's own
   *  explicit requirement). This repo has no way to verify that
   *  registration; siteConfig.siteName ("Brookings View" / "Moreno Valley
   *  View") is the best available source of truth here and should be
   *  double-checked against the real Publisher Center listing by the
   *  owner before relying on this. */
  publicationName: string;
  timezone: string;
  /** The town's own display name (siteConfig.cityName) -- used only to
   *  strip the "{cityName}: " prefix the Fas 3 title retrofit added to
   *  most story titles (see NEEDS-HUMAN-REVIEW.md #27) from news:title
   *  specifically. That prefix earns its keep as an on-page SEO/H1 signal,
   *  but news:title sits directly next to news:publication/news:name in
   *  Google's own News feed display -- repeating the town name there is
   *  exactly the "costs useful space" case the brief's own news:title
   *  requirement calls out. */
  cityName: string;
}

export type NewsSitemapStory = Pick<Story, 'slug' | 'title' | 'published_at'>;

/** True if `publishedAt` falls within the rolling 48-hour News-eligibility
 *  window as of `now` (defaults to the real current time; a real `now` is
 *  threaded through explicitly so this is deterministically testable). */
export function isWithinNewsWindow(publishedAt: string, now: Date = new Date()): boolean {
  const published = new Date(publishedAt).getTime();
  const cutoff = now.getTime() - NEWS_SITEMAP_WINDOW_HOURS * 60 * 60 * 1000;
  return published >= cutoff;
}

/** Strips a leading "{cityName}: " from a title for news:title -- see
 *  NewsSitemapSite.cityName's own comment for why. Only strips an EXACT,
 *  case-sensitive match at the very start; a title that happens to mention
 *  the town mid-sentence is left alone (this is a prefix-removal, not a
 *  general "hide the town name" pass). */
export function stripTownPrefix(title: string, cityName: string): string {
  const prefix = `${cityName}: `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the full news-sitemap.xml document. `stories` should already be
 * town-scoped (the caller's DB query handles that -- see
 * getStoriesForNewsSitemap()); this function re-applies the 48-hour filter
 * itself rather than trusting the caller, so a stale or overly-broad input
 * list can never leak an expired article into the sitemap.
 */
export function buildNewsSitemapXml(
  stories: NewsSitemapStory[],
  site: NewsSitemapSite,
  now: Date = new Date(),
): string {
  const eligible = stories.filter((s) => isWithinNewsWindow(s.published_at, now));

  const urlEntries = eligible.map((story) => {
    const loc = `${site.siteUrl}/s/${story.slug}/`;
    const publicationDate = toZonedISOString(story.published_at, site.timezone);
    const title = stripTownPrefix(story.title, site.cityName);
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(site.publicationName)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${publicationDate}</news:publication_date>
      <news:title>${escapeXml(title)}</news:title>
    </news:news>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urlEntries.join('\n')}
</urlset>
`;
}
