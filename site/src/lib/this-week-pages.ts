/** Every /this-week/<week>/ page's props, built once per build: this-week/[week].astro builds one page per entry, and
 *  this-week/index.astro renders the current week's entry at the rolling /this-week/ URL (F18, owner 2026-11-13). */
import {
  getAllWeeklyStories, getStoriesForWeekly, getAllArtsEvents, getAllProjectUpdatesForWeekly,
  getSeasonGames, getRegionalSports, getWorthKnowingCandidatesInRange,
} from './db';
import type { Story } from './db';
import {
  weekInfoForInstant, currentWeekInfo, previousWeekInfo, buildWeekDays, selectWeeklyLead,
  recentWeekSlugs, type WeekInfo, type DayBucket,
} from './this-week';
import { siteConfig } from './site-config';
import { sportTerms } from './sport-strings';
import { countWeekItems, isThinWeek } from './week-count.mjs';

export interface ThisWeekProps {
  week: WeekInfo; days: DayBucket[]; lead: Story | null;
  weeklyStory: Story | null; prevWeek: WeekInfo | null;
  isCurrent: boolean; isRecent: boolean; isThin: boolean;
}

let pages: Promise<ThisWeekProps[]> | null = null;

/** One entry per week that gets a page (see this-week/[week].astro's docstring for which weeks). */
export function getThisWeekPages(): Promise<ThisWeekProps[]> {
  pages ??= loadThisWeekPages();
  return pages;
}

/** The current week's entry; [week].astro always builds it. */
export async function getCurrentThisWeekPage(): Promise<ThisWeekProps> {
  return (await getThisWeekPages()).find((p) => p.isCurrent)!;
}

async function loadThisWeekPages(): Promise<ThisWeekProps[]> {
  const isBrookings = siteConfig.townId === 'brookings_sd';
  const [weeklyStories, eventStories, meetingStories, artsEvents, projectUpdates, games, regionalGames] =
    await Promise.all([
      getAllWeeklyStories(),
      getStoriesForWeekly(['event']),
      getStoriesForWeekly(['meeting', 'meeting_followup']),
      isBrookings ? getAllArtsEvents() : Promise.resolve([]),
      getAllProjectUpdatesForWeekly(),
      isBrookings ? getSeasonGames() : Promise.resolve([]),
      isBrookings ? Promise.resolve([]) : getRegionalSports(),
    ]);

  const weekInfos = new Map<string, WeekInfo>();
  const weeklyBySlug = new Map<string, Story>();
  for (const s of weeklyStories) {
    if (!s.occurs_at) continue;
    const info = weekInfoForInstant(new Date(s.occurs_at), siteConfig.timezone);
    weekInfos.set(info.slug, info);
    weeklyBySlug.set(info.slug, s);
  }
  const current = currentWeekInfo(siteConfig.timezone);
  weekInfos.set(current.slug, current); // "week ahead" -- real data, narrative may not exist yet
  const recentSlugs = recentWeekSlugs(weekInfos.keys(), siteConfig.recentWeeksIndexed);
  // Same count the sitemap filter uses (lib/week-count.mjs), so a week's noindex and its sitemap entry cannot disagree.
  const weekCounts = countWeekItems({
    stories: [...eventStories, ...meetingStories], artsEvents, projectUpdates,
    gameStarts: games.map((g) => g.starts_at), regionalGameDates: regionalGames.map((g) => g.game_date),
  }, siteConfig.timezone, siteConfig.meetingsHaveTime);

  return Promise.all([...weekInfos.values()].map(async (week) => {
    const days = buildWeekDays(week, siteConfig.timezone, {
      eventStories, meetingStories, artsEvents, projectUpdates, games, regionalGames, exhibitionLabel: sportTerms(siteConfig.country).exhibition,
      meetingsHaveTime: siteConfig.meetingsHaveTime,
    });
    const leadCandidates = await getWorthKnowingCandidatesInRange(week.start, week.end);
    const prev = previousWeekInfo(week, siteConfig.timezone);
    return {
      week, days, lead: selectWeeklyLead(leadCandidates),
      weeklyStory: weeklyBySlug.get(week.slug) ?? null,
      prevWeek: weekInfos.has(prev.slug) ? prev : null,
      isCurrent: week.slug === current.slug,
      isRecent: recentSlugs.has(week.slug),
      isThin: isThinWeek(weekCounts.get(week.slug) ?? 0),
    };
  }));
}
