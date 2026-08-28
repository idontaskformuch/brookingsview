/** Closure Watch (/closures) state machine -- see Handoff: Information Hub
 *  Tier 1, Feature A, and ai_pipeline/closure_watch_digest.py (which mirrors
 *  this same three-state decision on the Python side, for the AI-prose
 *  generation job). Kept as a pure function, separate from db.ts's actual
 *  queries, same tradeoff as lib/home-sales.ts -- unit-testable without a
 *  DB, see closure-watch.test.ts.
 *
 *  ABSOLUTE RULE (see closures.astro): the Watch state must never assert or
 *  imply a closure is coming. This module only decides WHICH of the three
 *  states applies -- the actual "no closure has been announced" copy is
 *  hardcoded in the page component, outside any AI path.
 */

export type ClosureWatchState = 'confirmed' | 'watch' | 'clear';

export interface SchoolClosure {
  district: string;
  title: string | null;
  message: string;
  url: string | null;
  posted_at: string;
}

export interface WeatherAlert {
  event: string;
  areaDesc: string | null;
  url: string | null;
  startsAt: string;
  endsAt: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
}

export interface ClosureWatchStatus {
  state: ClosureWatchState;
  closure: SchoolClosure | null;
  alert: WeatherAlert | null;
  /** How many closure_history rows exist for this alert's event type in this
   *  town -- 0 either means "never correlated" or "no history yet"; the
   *  caller can't tell those apart from this number alone, which is exactly
   *  why min_historical_closures_for_watch defaults to 0 (inert) until a
   *  human judges there's enough history to trust the distinction. */
  historicalCount: number;
}

/**
 * Confirmed always wins over Watch, regardless of what alert is active --
 * a district's own notice is ground truth. Watch downgrades to Clear when
 * minHistoricalClosuresForWatch is set (>0) and this specific alert event
 * hasn't met that bar in closure_history -- see that config field's own
 * comment in configs/<town_id>.json for why it ships inert (0) by default.
 */
export function computeClosureWatchState(
  closures: SchoolClosure[],
  activeAlert: WeatherAlert | null,
  historicalCount: number,
  minHistoricalClosuresForWatch: number,
): ClosureWatchStatus {
  if (closures.length > 0) {
    return { state: 'confirmed', closure: closures[0], alert: null, historicalCount: 0 };
  }
  if (!activeAlert) {
    return { state: 'clear', closure: null, alert: null, historicalCount: 0 };
  }
  if (minHistoricalClosuresForWatch > 0 && historicalCount < minHistoricalClosuresForWatch) {
    return { state: 'clear', closure: null, alert: activeAlert, historicalCount };
  }
  return { state: 'watch', closure: null, alert: activeAlert, historicalCount };
}
