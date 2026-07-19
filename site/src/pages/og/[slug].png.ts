/**
 * Delningsbild per story, genererad vid build-time.
 *
 * Astro kör getStaticPaths och skriver ut en färdig PNG per slug -- ingen
 * runtime-kostnad, inget externt anrop, ingen extra tjänst att underhålla.
 * "default" täcker startsidan och sektionssidorna.
 */
import type { APIRoute } from 'astro';
import { getAllStories, formatDate } from '../../lib/db';
import { renderOgImage } from '../../lib/og';

export async function getStaticPaths() {
  const stories = await getAllStories();
  return [
    {
      params: { slug: 'default' },
      props: {
        title: "What's happening in Brookings",
        sourceType: 'weekly',
        dateline: 'Brookings, South Dakota',
      },
    },
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
