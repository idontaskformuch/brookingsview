// Pure scheduling logic for the cron dispatcher -- no fetch, no env, so it is
// unit-testable (test/schedule.test.ts). index.ts only wires it to GitHub.
//
// Why this Worker exists: GitHub's own `schedule:` starts jobs 4.5-9.5 h late
// on this repo (measured 2026-10-21: closure-watch 10:30Z cron actually
// started 15:09-19:53Z), which makes a "05:30 local" run pointless.
// Cloudflare cron triggers fire on the minute.

export const SCRAPE_CRON = '0 */6 * * *';
// One trigger covers every UTC hour a 05:30 local time can land on (Central
// 10:30/11:30Z, Pacific 12:30/13:30Z, across DST); dueWorkflows() then keeps
// only the towns whose LOCAL clock actually reads 05:30. Cloudflare's free
// plan caps cron triggers per account, so this is one trigger, not four.
export const MORNING_CRON = '30 10-13 * * 1-5';

export const SCRAPE_WORKFLOWS = [
  'scrape.yml',
  'moval-scrape.yml',
  'broomfield-scrape.yml',
];

// Broomfield is deliberately absent: its school_alerts sources are disabled
// (zero runs/rows ever, Adams 12 bot-challenge, BVSD app-only), so a morning
// run there would only rebuild with nothing to show. Revisit when a source
// exists (see .claude/state.md, Kö 9).
export const MORNING_TOWNS = [
  { workflow: 'closure-watch-morning.yml', timeZone: 'America/Chicago' },
  { workflow: 'moval-closure-watch-morning.yml', timeZone: 'America/Los_Angeles' },
] as const;

export const MORNING_LOCAL_HOUR = 5;
// Cloudflare fires on the minute; tolerate a small skew either way.
const MORNING_MINUTE_FROM = 25;
const MORNING_MINUTE_TO = 40;

export function localParts(scheduledTime: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(scheduledTime));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

/** Workflow files to workflow_dispatch for a given cron + fire time. */
export function dueWorkflows(cron: string, scheduledTime: number): string[] {
  if (cron === SCRAPE_CRON) return [...SCRAPE_WORKFLOWS];
  if (cron === MORNING_CRON) {
    return MORNING_TOWNS.filter(({ timeZone }) => {
      const { hour, minute, weekday } = localParts(scheduledTime, timeZone);
      return (
        hour === MORNING_LOCAL_HOUR &&
        minute >= MORNING_MINUTE_FROM &&
        minute <= MORNING_MINUTE_TO &&
        weekday !== 'Sat' &&
        weekday !== 'Sun'
      );
    }).map((t) => t.workflow);
  }
  return [];
}
