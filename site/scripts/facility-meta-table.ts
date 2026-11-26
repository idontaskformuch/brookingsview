/** Old vs new <title> and meta description of every /facilities/<slug>/ page of one town (owner order 2026-11-26 (14): the table before the
 *  commit). The same functions and the same data as pages/facilities/[slug].astro: old = resolvePageMeta + facilityDescription, new =
 *  lib/facility-page-meta.ts. Reads the database, writes nothing. One JSON line per page on stdout.
 *    SITE_CITY=broomfield_co npx vite-node --config vite-node.config.ts scripts/facility-meta-table.ts */
import {
  getFacilities, getPlaceHours, getUpcomingPlaceHoursExceptions, getUpcomingStories, isPublicPlace,
} from '../src/lib/db';
import { eventsAtVenue } from '../src/lib/events';
import { siteConfig } from '../src/lib/site-config';
import { isSectionBuilt } from '../src/lib/sections';
import { facilityDescription } from '../src/lib/meta-description';
import { resolvePageMeta } from '../src/lib/page-meta';
import { facilityTitleElements } from '../src/lib/facility-lede';
import { effectiveHours } from '../src/lib/hours-spec';
import { PARK_HOURS } from '../src/config/park-hours';
import { todayDate } from '../src/lib/today-page';
import { isPastStalenessThreshold } from '../src/lib/place-hours';
import { THIN_FACILITY_MIN_OWN_WORDS } from '../src/lib/noindex';
import { facilityPageMeta, datedCalendarRows } from '../src/lib/facility-page-meta';

async function main(): Promise<void> {
  if (!isSectionBuilt('facilities', siteConfig)) return;
  const now = new Date();
  const today = todayDate(now, siteConfig.timezone).iso;
  const facilities = await getFacilities();
  const upcoming = await getUpcomingStories(['event'], 200);
  const parkRule = PARK_HOURS[siteConfig.townId] ?? null;
  const staleness = siteConfig.placeStaleness ?? { hoursDays: 45, addressPhoneDays: 180 };
  for (const facility of facilities) {
    const [placeHoursRows, exceptions] = await Promise.all([getPlaceHours(facility.id), getUpcomingPlaceHoursExceptions(facility.id)]);
    const effective = effectiveHours(facility, placeHoursRows, today, parkRule);
    const hours = effective?.rows ?? [];
    const hoursStale = isPastStalenessThreshold(facility.verified_date, staleness.hoursDays, now);
    const upcomingHere = eventsAtVenue(upcoming, facilities, facility.slug, undefined, 5);
    const oldTitle = resolvePageMeta('facilities/detail', siteConfig, {
      FacilityName: facility.name,
      Elements: facilityTitleElements(Boolean(facility.hours_text) || placeHoursRows.length > 0, Boolean(facility.address), Boolean(facility.phone), facility.name.length),
    }).title;
    const oldMeta = facilityDescription(siteConfig, facility);
    const datedRows = effective?.dated ? datedCalendarRows(effective.pillRows) : undefined;
    const neu = facilityPageMeta(
      { facility, hoursRows: hours, hoursStale, hoursSource: effective?.source ?? null, exceptions, upcomingEvents: upcomingHere.length, datedRows },
      { town: siteConfig.cityName, today, country: siteConfig.country === 'gb' ? 'gb' : 'us', townId: siteConfig.townId, slug: facility.slug },
    );
    // The page's own noindex rules (pages/facilities/[slug].astro), so the table can say which pages Google sees.
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    const thin = (!facility.address && !facility.phone && !facility.hours_text && placeHoursRows.length === 0)
      || (!facility.street_address && !facility.phone && !facility.hours_text && placeHoursRows.length === 0 && !(facility.services && facility.services.length > 0));
    const textThin = words(facility.description ?? '') + words((facility.services ?? []).join(' ')) < THIN_FACILITY_MIN_OWN_WORDS;
    const indexable = !thin && !textThin && isPublicPlace(facility);
    console.log(JSON.stringify({
      town: siteConfig.townId, slug: facility.slug, indexable, hoursSource: effective?.source ?? null,
      oldTitle, oldMeta, newTitle: neu.title, newMeta: neu.description, fallbacks: neu.fallbacks,
      // The input as read (for test fixtures from real rows: rule 15).
      input: {
        name: facility.name, category: facility.category, hours_structured: facility.hours_structured, street_address: facility.street_address, address: facility.address, phone: facility.phone,
        hours_text: facility.hours_text, is_free: facility.is_free, services: facility.services, accessibility_note: facility.accessibility_note,
        description: facility.description, hoursRows: hours.map((r) => ({ day_of_week: r.day_of_week, opens: r.opens, closes: r.closes })),
        hoursStale, hoursSource: effective?.source ?? null, exceptions: exceptions.map((e) => ({ date: e.date, opens: e.opens, closes: e.closes })), upcomingEvents: upcomingHere.length,
        ...(datedRows ? { datedRows } : {}),
      },
    }));
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
