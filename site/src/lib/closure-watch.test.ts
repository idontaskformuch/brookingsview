import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeClosureWatchState, type SchoolClosure, type WeatherAlert } from './closure-watch';

/**
 * computeClosureWatchState() mirrors ai_pipeline/closure_watch_digest.py's
 * compute_closure_watch_state() exactly -- two independent implementations
 * of the same three-state decision, one per language, is precisely the
 * setup that drifts silently (same risk tests/test_feature_flags.py's
 * cross-system check was built for in Step 1). The state-machine cases
 * below are loaded from the SAME tests/fixtures/closure_watch_cases.json
 * the Python suite reads -- a change to one implementation that the other
 * doesn't match fails in exactly one suite, without anyone needing to
 * remember to update two independently-written test files by hand.
 */
interface GoldenCase {
  name: string;
  hasClosure: boolean;
  hasAlert: boolean;
  historicalCount: number;
  minRequired: number;
  expectedState: 'confirmed' | 'watch' | 'clear';
}

const FIXTURES_PATH = fileURLToPath(new URL('../../../tests/fixtures/closure_watch_cases.json', import.meta.url));
const GOLDEN_CASES: GoldenCase[] = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8'));

const DUMMY_CLOSURE: SchoolClosure = {
  district: 'Test District', title: 't', message: 'm', url: null, posted_at: '2026-01-01',
};
const DUMMY_ALERT: WeatherAlert = {
  event: 'Test Alert', areaDesc: null, url: 'https://example.com/alert',
  startsAt: '2026-01-01T00:00:00Z', endsAt: null, headline: null, description: null, instruction: null,
};

describe('computeClosureWatchState -- golden cases (shared with the Python suite)', () => {
  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const closures = c.hasClosure ? [DUMMY_CLOSURE] : [];
      const alert = c.hasAlert ? DUMMY_ALERT : null;
      const status = computeClosureWatchState(closures, alert, c.historicalCount, c.minRequired);
      expect(status.state).toBe(c.expectedState);
    });
  }
});

describe('computeClosureWatchState -- transition, not expressible as a single golden case', () => {
  const CLOSURE: SchoolClosure = {
    district: 'Brookings School District 05-1',
    title: 'District closed today',
    message: 'All Brookings School District 05-1 schools are closed today due to weather.',
    url: 'https://www.brookings.k12.sd.us/',
    posted_at: '2026-02-01T12:00:00Z',
  };
  const ALERT: WeatherAlert = {
    event: 'Winter Storm Warning',
    areaDesc: 'Brookings County',
    url: 'https://api.weather.gov/alerts/abc123',
    startsAt: '2026-02-01T00:00:00Z',
    endsAt: '2026-02-02T00:00:00Z',
    headline: 'Winter Storm Warning issued',
    description: 'Heavy snow expected.',
    instruction: 'Travel is not advised.',
  };

  it('transitions from watch to confirmed once a district notice appears', () => {
    const before = computeClosureWatchState([], ALERT, 0, 0);
    expect(before.state).toBe('watch');
    const after = computeClosureWatchState([CLOSURE], ALERT, 0, 0);
    expect(after.state).toBe('confirmed');
  });

  it('carries the alert through on the status object even though Confirmed wins', () => {
    const status = computeClosureWatchState([CLOSURE], ALERT, 5, 0);
    expect(status.closure).toBe(CLOSURE);
    expect(status.alert).toBeNull();
  });
});
