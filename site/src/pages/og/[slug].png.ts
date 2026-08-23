/**
 * Delningsbild per story, genererad vid build-time.
 *
 * Astro kör getStaticPaths och skriver ut en färdig PNG per slug -- ingen
 * runtime-kostnad, inget externt anrop, ingen extra tjänst att underhålla.
 * "default" täcker startsidan och sektionssidorna.
 */
import type { APIRoute } from 'astro';
import { getAllStories, getFacilities, formatDate } from '../../lib/db';
import { renderOgImage } from '../../lib/og';
import { siteConfig } from '../../lib/site-config';

const isBrookings = siteConfig.townId === 'brookings_sd';
const isMorenoValley = siteConfig.townId === 'moreno_valley_ca';

// Section/vertical pages -- distinct from per-story cards below. Before
// this, none of these passed an ogSlug (see NEEDS-HUMAN-REVIEW.md "4.5 OG
// image audit"), so every one of them shared the exact same /og/default.png
// as the homepage -- the "all links look identical" problem this module's
// own docstring already warns against, just not yet applied to whole
// sections. slug here becomes the literal /og/<slug>.png filename, matched
// by each page's own `ogSlug` prop.
const SECTION_CARDS: { slug: string; title: string; kicker: string }[] = [
  { slug: 'section-events', title: `Events in ${siteConfig.cityName}`, kicker: 'Events' },
  { slug: 'section-city-hall', title: `City hall — ${siteConfig.cityName}`, kicker: 'City hall' },
  { slug: 'section-weather', title: `Weather — ${siteConfig.cityName}`, kicker: 'Weather' },
  { slug: 'section-traffic', title: `Traffic — ${siteConfig.cityName}`, kicker: 'Traffic' },
  { slug: 'section-jobs', title: `Jobs in and near ${siteConfig.cityName}`, kicker: 'Jobs' },
  { slug: 'section-facilities', title: `Local facilities — ${siteConfig.cityName}`, kicker: 'Facilities' },
  ...(isMorenoValley ? [
    { slug: 'section-home-sales', title: `Recent home sales — ${siteConfig.cityName}`, kicker: 'Home sales' },
    { slug: 'section-workplace-watch', title: `Worker Pulse — ${siteConfig.cityName}`, kicker: 'Worker Pulse' },
  ] : []),
  ...(isBrookings ? [
    { slug: 'section-farm-report', title: `Farm report — ${siteConfig.cityName}`, kicker: 'Farm report' },
  ] : []),
];

export async function getStaticPaths() {
  const [stories, facilities] = await Promise.all([getAllStories(), getFacilities()]);
  return [
    {
      params: { slug: 'default' },
      props: {
        title: `What's happening in ${siteConfig.cityName}`,
        sourceType: 'weekly',
        dateline: `${siteConfig.cityName}, ${siteConfig.stateName}`,
      },
    },
    ...SECTION_CARDS.map((s) => ({
      params: { slug: s.slug },
      props: { title: s.title, sourceType: s.slug, kickerOverride: s.kicker, dateline: null },
    })),
    ...facilities.map((f) => ({
      params: { slug: `facility-${f.slug}` },
      props: { title: f.name, sourceType: 'facility', dateline: null },
    })),
    ...stories.map((story) => ({
      params: { slug: story.slug },
      props: {
        title: story.title,
        sourceType: story.source_type,
        dateline: story.occurs_at ? formatDate(story.occurs_at) : null,
      },
    })),
  ];
}

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImage(props as any);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
