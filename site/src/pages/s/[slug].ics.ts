/** Phase 4, "Add to calendar" (2026-10-09): one .ics file per upcoming
 *  event, generated at build time -- same "no runtime cost, nothing extra
 *  to maintain" reasoning as og/[slug].png.ts. See lib/ics.ts for the
 *  actual VEVENT construction and its own timezone-approach comment.
 *
 *  Scoped to upcoming events only (getUpcomingStories(['event'], ...) is
 *  already the "occurs_at >= now() - 12h" query every other upcoming-
 *  events feature on this site reuses) -- a past event's .ics would just
 *  be dead weight in the build output forever. Recurring-series rows are
 *  filtered out here too: lib/ics.ts's buildIcsEvent() already returns
 *  null for one, but getStaticPaths() dropping them first means no path
 *  is ever generated for one at all, not a build that silently produces
 *  nothing at a real URL.
 */
import type { APIRoute } from 'astro';
import { getUpcomingStories, getFacilities } from '../../lib/db';
import type { Story, Facility } from '../../lib/db';
import { buildIcsEvent } from '../../lib/ics';
import { siteConfig } from '../../lib/site-config';
import { publicSlug, storyHref } from '../../lib/content-slugs';

export async function getStaticPaths() {
  const [events, facilities] = await Promise.all([
    getUpcomingStories(['event'], 500),
    getFacilities(),
  ]);
  return events
    .filter((e) => !e.is_recurring_series)
    .map((story) => ({ params: { slug: publicSlug(story.slug) }, props: { story, facilities } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const { story, facilities } = props as { story: Story; facilities: Facility[] };
  const pageUrl = new URL(storyHref(story.slug), site ?? siteConfig.siteUrl).href;
  const ics = buildIcsEvent(story, facilities, siteConfig, pageUrl);
  if (!ics) {
    // getStaticPaths() above only ever generates a path for a real,
    // non-recurring upcoming event -- buildIcsEvent() returning null here
    // would mean this file's own filter and lib/ics.ts's guard clause
    // have drifted apart. Fail the build loudly rather than silently ship
    // an empty or wrong .ics file at a real URL.
    throw new Error(`buildIcsEvent() returned null for a path getStaticPaths() generated: ${story.slug}`);
  }
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${publicSlug(story.slug)}.ics"`,
    },
  });
};
