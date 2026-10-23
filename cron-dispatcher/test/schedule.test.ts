import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MORNING_CRON, SCRAPE_CRON, SCRAPE_WORKFLOWS, dueWorkflows } from '../src/schedule';

const at = (iso: string) => Date.parse(iso);

describe('wrangler.jsonc', () => {
  it('registers exactly the crons schedule.ts dispatches on', () => {
    const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(cfg).toContain(`"crons": ["${SCRAPE_CRON}", "${MORNING_CRON}"]`);
  });
});

describe('scrape cron', () => {
  it('dispatches all four scrape workflows (Glasgow included)', () => {
    expect(dueWorkflows(SCRAPE_CRON, at('2026-10-21T06:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
  });
  it('unknown cron dispatches nothing', () => {
    expect(dueWorkflows('* * * * *', at('2026-10-21T06:00:00Z'))).toEqual([]);
  });
});

describe('morning closure-watch', () => {
  const CHI = 'closure-watch-morning.yml';
  const LA = 'moval-closure-watch-morning.yml';

  it('summer (DST): Central fires 10:30Z, Pacific 12:30Z', () => {
    expect(dueWorkflows(MORNING_CRON, at('2026-07-15T10:30:00Z'))).toEqual([CHI]);
    expect(dueWorkflows(MORNING_CRON, at('2026-07-15T11:30:00Z'))).toEqual([]);
    expect(dueWorkflows(MORNING_CRON, at('2026-07-15T12:30:00Z'))).toEqual([LA]);
    expect(dueWorkflows(MORNING_CRON, at('2026-07-15T13:30:00Z'))).toEqual([]);
  });

  it('winter (standard time): Central fires 11:30Z, Pacific 13:30Z', () => {
    expect(dueWorkflows(MORNING_CRON, at('2026-12-15T10:30:00Z'))).toEqual([]);
    expect(dueWorkflows(MORNING_CRON, at('2026-12-15T11:30:00Z'))).toEqual([CHI]);
    expect(dueWorkflows(MORNING_CRON, at('2026-12-15T12:30:00Z'))).toEqual([]);
    expect(dueWorkflows(MORNING_CRON, at('2026-12-15T13:30:00Z'))).toEqual([LA]);
  });

  it('each town fires exactly once per weekday across the four UTC slots, all year', () => {
    for (const day of ['2026-03-09', '2026-03-10', '2026-11-02', '2026-11-03', '2026-10-21']) {
      const fired = ['10', '11', '12', '13'].flatMap((h) => dueWorkflows(MORNING_CRON, at(`${day}T${h}:30:00Z`)));
      expect(fired.sort()).toEqual([CHI, LA]);
    }
  });

  it('DST changeover days still fire once (US spring forward 2026-03-08, fall back 2026-11-01 are Sundays; Mon after)', () => {
    for (const day of ['2026-03-09', '2026-11-02']) {
      const fired = ['10', '11', '12', '13'].flatMap((h) => dueWorkflows(MORNING_CRON, at(`${day}T${h}:30:00Z`)));
      expect(fired).toHaveLength(2);
    }
  });

  it('never fires on a local weekend even if the cron slot is a UTC weekday', () => {
    // Sat 2026-10-24 05:30 CDT = 10:30Z Saturday; the cron's MON-FRI filter would
    // normally stop this, the weekday check is a second guard.
    expect(dueWorkflows(MORNING_CRON, at('2026-10-24T10:30:00Z'))).toEqual([]);
    expect(dueWorkflows(MORNING_CRON, at('2026-10-25T10:30:00Z'))).toEqual([]);
  });

  it('tolerates a few minutes of skew but not an hour', () => {
    expect(dueWorkflows(MORNING_CRON, at('2026-10-21T10:33:00Z'))).toEqual([CHI]);
    expect(dueWorkflows(MORNING_CRON, at('2026-10-21T10:00:00Z'))).toEqual([]);
  });

  it('Broomfield has no morning workflow (school_alerts sources disabled)', () => {
    const all = ['10', '11', '12', '13'].flatMap((h) => dueWorkflows(MORNING_CRON, at(`2026-10-21T${h}:30:00Z`)));
    expect(all.some((w) => w.includes('broomfield'))).toBe(false);
  });
});
