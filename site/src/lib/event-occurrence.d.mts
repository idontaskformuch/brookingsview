export const SERIES_SLUG_PREFIX: string;
export function isCountedOccurrence(row: { slug: string; superseded_by_slug?: string | null }): boolean;
export function listedEventRows<T extends { slug: string; superseded_by_slug?: string | null; occurs_at?: string | Date | null }>(
  rows: T[], timeZone: string,
): T[];
