/**
 * Phase 8 ("Month in <Town>") -- dev-only preview tool, owner condition 8
 * ("show the September page in plain text, all numbers + template
 * sentences, before push"). Prints exactly what the real /month/<slug>/
 * page will render for one town+month, straight from live data, without
 * needing a full astro build. Not wired into the build, no committed
 * artifact.
 *
 * Usage (from site/):
 *   SITE_CITY=moreno_valley_ca npx vite-node --config vite-node.config.ts scripts/preview-month-in-review.ts 2026-09
 */
import {
  monthBoundsUTC, monthLabel, parseMonthSlug, listEligibleMonths,
  buildDecisionsModule, buildProjectsModule, buildSalesModule, buildEventsModule,
  buildTrafficModule, buildJobsModule,
  decisionsSentence, projectsSentence, salesSentence, eventsSentence, trafficSentence, jobsSentence,
  clearedModuleCount, MIN_MODULES_FOR_INDEX,
} from '../src/lib/month-in-review';
import { siteConfig } from '../src/lib/site-config';

async function main() {
  const slugArg = process.argv[2];
  if (!slugArg) {
    console.error('Usage: preview-month-in-review.ts <yyyy-mm>');
    console.error('Eligible months for', siteConfig.townId, ':',
      listEligibleMonths(siteConfig.townId, siteConfig.timezone).map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`).join(', ') || '(none)');
    process.exitCode = 1;
    return;
  }
  const parsed = parseMonthSlug(slugArg);
  if (!parsed) {
    console.error(`Not a valid yyyy-mm slug: "${slugArg}"`);
    process.exitCode = 1;
    return;
  }
  const { year, month } = parsed;
  const { start, end } = monthBoundsUTC(year, month);
  const label = monthLabel(year, month);

  const [decisions, projects, sales, events, traffic, jobs] = await Promise.all([
    buildDecisionsModule(start, end),
    buildProjectsModule(start, end),
    buildSalesModule(start, end),
    buildEventsModule(year, month, siteConfig.timezone, siteConfig.townId, siteConfig.cityName, siteConfig.townCenter),
    buildTrafficModule(start, end, siteConfig.townId, siteConfig.trafficCorridors, siteConfig.trafficCorridorMaxMiles),
    buildJobsModule(start, end, siteConfig.cityName),
  ]);

  const cleared = clearedModuleCount([decisions, projects, sales, events, traffic, jobs]);
  const noindex = cleared < MIN_MODULES_FOR_INDEX;
  const trafficSourceName = siteConfig.trafficSource?.name ?? 'our traffic coverage';

  console.log('='.repeat(78));
  console.log(`title: ${siteConfig.cityName} in ${label} — ${siteConfig.siteName}`);
  console.log(`h1:    ${siteConfig.cityName} in ${label}`);
  console.log(`url:   /month/${slugArg}/`);
  console.log('='.repeat(78));
  console.log(`cleared modules: ${cleared} of 6  (gate: >=${MIN_MODULES_FOR_INDEX})  ->  ${noindex ? 'NOINDEX' : 'indexable'}`);
  console.log();
  console.log(`lede: A numbers-only recap of ${siteConfig.cityName}, ${siteConfig.stateAbbr} for ${label}, `
    + `compiled from public data sources. See all months.`);
  console.log();

  const rows: [string, unknown, string | null][] = [
    ['Decisions', decisions, decisionsSentence(decisions, label, siteConfig.cityName, siteConfig.siteName)],
    ['Projects', projects, projectsSentence(projects, label, siteConfig.cityName, siteConfig.siteName)],
    ['Home sales', sales, salesSentence(sales, label, siteConfig.cityName)],
    ['Events', events, eventsSentence(events, label, siteConfig.cityName, siteConfig.siteName)],
    ['Traffic', traffic, trafficSentence(traffic, label, siteConfig.cityName, trafficSourceName)],
    ['Jobs', jobs, jobsSentence(jobs, label, siteConfig.cityName)],
  ];

  for (const [name, mod, sentence] of rows) {
    console.log(`--- ${name} ---`);
    console.log('  raw:', JSON.stringify(mod));
    console.log('  rendered:', sentence ?? '(module omitted -- no sentence rendered)');
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
