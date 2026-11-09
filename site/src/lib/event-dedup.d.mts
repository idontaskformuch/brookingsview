export interface EventSourceConfig {
  crossMatch: boolean;
}

export interface DedupItem {
  sourceKind: 'story' | 'arts';
  occurs_at: string | null;
}

type TitledItem =
  | { sourceKind: 'story'; story: { title: string; source_url?: string | null; venue_raw?: string | null } }
  | { sourceKind: 'arts'; event: { title: string; event_url: string | null; location: string | null } };

export function itemTitle(item: TitledItem): string;
export function itemUrl(item: TitledItem): string | null;
export function itemVenue(item: TitledItem): string | null;
export function localDateParts(instant: Date, timezone: string): { y: number; m: number; d: number };
export const EVENT_SOURCES: Record<string, EventSourceConfig>;
export function findCrossSourceMatch<T>(
  sourceKind: string,
  dateKey: string | null,
  normalizedTitle: string,
  canonicalByKey: Map<string, T>,
  sources: Record<string, EventSourceConfig>,
): T | undefined;
export function buildEventFeedCore<T extends DedupItem>(
  rawItems: T[],
  timezone: string,
): { items: T[]; alsoListedBy: Map<T, string[]> };
