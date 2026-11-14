export interface FrozenSource { since: string; showDays: number }
export const FROZEN_EVENT_SOURCES: Record<string, Record<string, FrozenSource>>;
export const FROZEN_HIDDEN_EVENTS_ASSET: string;
export function frozenCutoff(frozen: FrozenSource, timeZone: string): Date;
export function hiddenFrozenSlugs(
  rows: { slug: string; source: string | null; occurs_at: string | Date | null }[],
  frozen: Record<string, FrozenSource> | undefined,
  timeZone: string,
): string[];
