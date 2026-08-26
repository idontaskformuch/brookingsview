/**
 * Metadata for the Week 2 event landing pages (see NEEDS-HUMAN-REVIEW.md,
 * "Week 2 -- Event Landing Pages") -- one shared list so events.astro's
 * cross-link row and pages/events/[facet].astro's getStaticPaths never
 * drift out of sync with each other.
 *
 * Titles/descriptions deliberately front-load the local keyword the way
 * people actually search ("free events in moreno valley this weekend"),
 * per the brief -- never "morenovalleyview events."
 */
import type { Facility } from './db';
import {
  type FeedItem, isToday, isThisWeekend, isFreeEvent, isLibraryEvent, isKidsEvent, isCampusEvent,
} from './events';
import { EMPTY_STATES } from './empty-states';

export interface FacetContext {
  facilities: Facility[];
  today: Date;
  timezone: string;
}

export interface EventFacet {
  slug: string;
  /** Short label for nav pills / cross-links, e.g. "This weekend." */
  navLabel: string;
  /** <h1> on the facet's own landing page. */
  heading: string;
  titleTemplate: (cityName: string, siteName: string) => string;
  descriptionTemplate: (cityName: string) => string;
  /** 1-2 sentence intro copy under the <h1>, real prose (not an empty
   *  heading over a list). */
  intro: (cityName: string) => string;
  /** Shown when the filtered list is empty -- never a blank/broken page. */
  emptyMessage: string;
  matches: (item: FeedItem, ctx: FacetContext) => boolean;
  /** Only Brookings has a campus facet -- gated at getStaticPaths, not
   *  forced onto Moreno Valley (which has no SDSU equivalent). */
  brookingsOnly?: boolean;
}

export const EVENT_FACETS: EventFacet[] = [
  {
    slug: 'today',
    navLabel: 'Today',
    heading: "Today's events",
    titleTemplate: (cityName, siteName) => `Events Today in ${cityName} — ${siteName}`,
    descriptionTemplate: (cityName) =>
      `What's happening today in ${cityName} — library programs, city events and community happenings, updated daily.`,
    intro: (cityName) => `Everything on the calendar today in ${cityName}, updated daily.`,
    emptyMessage: EMPTY_STATES.eventsToday,
    matches: (item, ctx) => isToday(item, ctx.today, ctx.timezone),
  },
  {
    slug: 'this-weekend',
    navLabel: 'This weekend',
    heading: 'Events this weekend',
    titleTemplate: (cityName, siteName) => `Events This Weekend in ${cityName} — ${siteName}`,
    descriptionTemplate: (cityName) =>
      `What's on this weekend in ${cityName} — Friday through Sunday, updated daily.`,
    intro: (cityName) => `What's on Friday through Sunday in ${cityName}, updated daily.`,
    emptyMessage: EMPTY_STATES.eventsWeekend,
    matches: (item, ctx) => isThisWeekend(item, ctx.today, ctx.timezone),
  },
  {
    slug: 'free',
    navLabel: 'Free',
    heading: 'Free events',
    titleTemplate: (cityName, siteName) => `Free Events in ${cityName} This Week — ${siteName}`,
    descriptionTemplate: (cityName) =>
      `Free things to do in ${cityName} this week — library, park and community-center programs, updated daily.`,
    intro: (cityName) =>
      `Free things to do in ${cityName} this week, updated daily. Limited to events at the ` +
      'library, parks and community centers -- the only venues where "free" is a known fact, not a guess.',
    emptyMessage: EMPTY_STATES.eventsFree,
    matches: (item, ctx) => isFreeEvent(item, ctx.facilities),
  },
  {
    slug: 'kids',
    navLabel: 'Kids & family',
    heading: 'Kids & family events',
    titleTemplate: (cityName, siteName) => `Kids & Family Events in ${cityName} — ${siteName}`,
    descriptionTemplate: (cityName) =>
      `Family-friendly and kids' events in ${cityName} — storytimes, family nights and youth programs, updated daily.`,
    intro: (cityName) => `Storytimes, family nights and youth programs in ${cityName}, updated daily.`,
    emptyMessage: EMPTY_STATES.eventsKids,
    matches: (item) => isKidsEvent(item),
  },
  {
    slug: 'library',
    navLabel: 'Library',
    heading: 'Library events',
    titleTemplate: (cityName, siteName) => `Library Events in ${cityName} — ${siteName}`,
    descriptionTemplate: (cityName) =>
      `What's on at the ${cityName} public library — classes, storytimes and programs, updated daily.`,
    intro: (cityName) => `Everything on the calendar at the ${cityName} public library, updated daily.`,
    emptyMessage: EMPTY_STATES.eventsLibrary,
    matches: (item, ctx) => isLibraryEvent(item, ctx.facilities),
  },
  {
    slug: 'campus',
    navLabel: 'SDSU campus',
    heading: 'SDSU campus events',
    titleTemplate: (cityName, siteName) => `SDSU Campus Events in ${cityName} — ${siteName}`,
    descriptionTemplate: () =>
      `Arts, culture and campus events at South Dakota State University, updated daily.`,
    intro: () => `Concerts, exhibits and campus happenings at South Dakota State University, updated daily.`,
    emptyMessage: EMPTY_STATES.eventsCampus,
    matches: (item) => isCampusEvent(item),
    brookingsOnly: true,
  },
];
