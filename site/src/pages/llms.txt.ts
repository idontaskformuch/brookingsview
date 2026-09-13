/** Answer-engine-visibility handoff, Section 2: llms.txt, per the
 *  Answer.AI spec (llmstxt.org) -- generated at build time from the SAME
 *  cluster graph every hub/spoke page already resolves against
 *  (computeTownGraph(), Phase 1-5 of the topical-authority handoff), never
 *  hand-maintained. Gating reuses ROUTE_AVAILABILITY directly (via
 *  computeTownGraph -- a disabled route is simply absent from its output),
 *  the same "one source of truth, can't drift" property the rest of that
 *  handoff already established. Concretely: Broomfield's graph never
 *  contains 'workplace-watch' or 'university', so neither can ever appear
 *  here -- not a second, hand-maintained exclusion list.
 *
 *  Deliberately does NOT generate llms-full.txt (the companion "inline
 *  every page's full text" file the same spec also defines) -- for a
 *  daily-updating local news site that's an enormous, immediately-stale
 *  artifact with no demonstrated benefit; the spec's own "honest framing"
 *  section is explicit that llms.txt itself is a low-cost bet on the
 *  agentic web maturing, not a guaranteed win, and llms-full.txt has an
 *  even weaker case than that.
 *
 *  Links individual stories NOWHERE -- only hubs and other durable
 *  reference pages (per the handoff's own "link the durable map, not what
 *  churns" rule) -- with one deliberate, spec-named exception: facility
 *  pages, listed individually under their own "Public facilities" section,
 *  since they're exactly the stable, factual, individually-citable pages
 *  this file exists for. */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';
import { computeTownGraph } from '../lib/clusters';
import { HUB_HREF, HUB_NAV_COPY, SPOKE_NAV_COPY } from '../config/clusters';
import { getFacilities, FACILITY_CATEGORY_LABELS } from '../lib/db';

function interpolate(text: string): string {
  return text.replaceAll('{Town}', siteConfig.cityName);
}

function absoluteUrl(path: string): string {
  return new URL(path, siteConfig.siteUrl).href;
}

export const GET: APIRoute = async () => {
  const graph = computeTownGraph(siteConfig);
  const facilities = await getFacilities();

  const lines: string[] = [
    `# ${siteConfig.siteName}`,
    '',
    `> Local public-information coverage for ${siteConfig.cityName}, ${siteConfig.stateAbbr}. ` +
      `${siteConfig.sourceBlurb} Every item links back to its original source. Updated hourly.`,
    '',
    // Paraphrased from how-we-gather-this.astro's own real "How the
    // summaries are written" section -- the provenance/method sentence
    // the spec's own Section 2 says "is doing more work for citability
    // than the link list is," not freshly invented framing.
    "Every summary is written by an AI model working only from the named source above -- never adding a fact, name or number that isn't in it -- and checked against that source before publishing.",
  ];

  for (const cluster of graph.clusters) {
    if (!cluster.hubAvailable) continue;

    if (cluster.key === 'places') {
      // The spec's own explicit exception: facility pages are the stable,
      // factual, individually citable content this file exists for --
      // listed one by one, not just the hub.
      lines.push('', '## Public facilities', '');
      const facilitiesCopy = HUB_NAV_COPY.facilities;
      lines.push(
        `- [${facilitiesCopy?.label ?? 'Facilities index'}](${absoluteUrl(HUB_HREF.facilities)})` +
          (facilitiesCopy ? `: ${interpolate(facilitiesCopy.description)}` : ''),
      );
      for (const facility of facilities) {
        const categoryLabel = FACILITY_CATEGORY_LABELS[facility.category] ?? facility.category;
        const note = facility.address ? `${categoryLabel}, ${facility.address}.` : `${categoryLabel}.`;
        lines.push(`- [${facility.name}](${absoluteUrl(`/facilities/${facility.slug}/`)}): ${note}`);
      }
      const weatherCopy = cluster.spokes.some((s) => s.routeKey === 'weather') ? SPOKE_NAV_COPY.weather : null;
      if (weatherCopy) {
        lines.push(`- [${weatherCopy.label}](${absoluteUrl(weatherCopy.href)}): ${weatherCopy.description}`);
      }
      continue;
    }

    const hubHref = HUB_HREF[cluster.hubRoute];
    if (!hubHref) continue; // every real hub is registered in HUB_HREF -- defensive, shouldn't happen

    lines.push('', `## ${cluster.label}`, '');
    const hubCopy = HUB_NAV_COPY[cluster.hubRoute];
    lines.push(
      `- [${hubCopy?.label ?? cluster.label}](${absoluteUrl(hubHref)})` +
        (hubCopy ? `: ${interpolate(hubCopy.description)}` : ''),
    );

    for (const spoke of cluster.spokes) {
      const copy = SPOKE_NAV_COPY[spoke.routeKey];
      // "detail"/"story:<sourceType>" groups and a few un-navigable spokes
      // have no registered copy -- expected (same "not every spoke is a
      // hub-nav candidate" contract resolveHubNavItems() already
      // documents), not a gap to fill here.
      if (!copy) continue;
      lines.push(`- [${copy.label}](${absoluteUrl(copy.href)}): ${copy.description}`);
    }
  }

  lines.push(
    '', '## Optional', '',
    `- [How we gather this](${absoluteUrl('/how-we-gather-this/')}): Sources and method.`,
    `- [Editorial policy](${absoluteUrl('/editorial-policy/')})`,
    `- [Corrections](${absoluteUrl('/corrections/')})`,
    '',
  );

  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
