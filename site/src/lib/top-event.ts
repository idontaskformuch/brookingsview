/** Top-event marquee selection (configs/<town_id>.json features.top_events).
 *
 *  A town lists title PATTERNS (e.g. "Hobo Day"), never dates. The event itself is
 *  found in the data we already hold (the upcoming event stories); it is shown
 *  from `leadDays` days before it starts until it has ended, and the browser hides
 *  the card on its own once the day has passed (data-start/data-end). A town with
 *  no config gets nothing. Pure, so it is tested with a fake clock. */
import { hasEnded, localDayNumber } from './local-day';

export interface TopEventConfig { patterns: string[]; leadDays: number }

export interface TopEventCandidate {
  title: string;
  occurs_at: string | null;
  ends_at?: string | null;
}

export function matchesTopEvent(title: string, patterns: string[]): boolean {
  const t = title.toLowerCase();
  return patterns.some((p) => p.trim() !== '' && t.includes(p.trim().toLowerCase()));
}

/** The earliest matching event that has not ended and starts within `leadDays`
 *  calendar days (town timezone) -- or is already under way today. */
export function selectTopEvent<T extends TopEventCandidate>(
  events: T[], cfg: TopEventConfig | undefined, now: Date, timezone: string,
): T | null {
  if (!cfg || cfg.patterns.length === 0) return null;
  const today = localDayNumber(now, timezone);
  const live = events
    .filter((e) => e.occurs_at && matchesTopEvent(e.title, cfg.patterns))
    .filter((e) => !hasEnded({ start: e.occurs_at as string, end: e.ends_at ?? null }, now, timezone))
    .filter((e) => localDayNumber(new Date(e.occurs_at as string), timezone) - today <= cfg.leadDays)
    .sort((a, b) => new Date(a.occurs_at as string).getTime() - new Date(b.occurs_at as string).getTime());
  return live[0] ?? null;
}
