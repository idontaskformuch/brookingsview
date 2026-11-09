export const THIS_WEEK_MIN_ITEMS: number;
export function isoWeekSlug(parts: { y: number; m: number; d: number }): string;
export function countWeekItems(
  data: {
    stories: { source_type: string; occurs_at: string | null; superseded_by_slug?: string | null; title: string; source_url?: string | null; venue_raw?: string | null }[];
    artsEvents?: { title: string; starts_at: string | null; event_url: string | null; location: string | null }[];
    projectUpdates?: { meeting_date: string | Date | null }[];
    gameStarts?: (string | Date | null)[];
    regionalGameDates?: (string | Date | null)[];
  },
  timezone: string,
): Map<string, number>;
export function isThinWeek(count: number): boolean;
