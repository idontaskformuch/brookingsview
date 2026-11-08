import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALERTS_CRON } from '../src/alerts/towns';
import { MORNING_CRON, OSM_WORKFLOW, REGISTER_WORKFLOW, SCRAPE_CRON, SCRAPE_WORKFLOWS, SPORTS_UTC_HOUR, SPORTS_WORKFLOW, dueWorkflows } from '../src/schedule';

const at = (iso: string) => Date.parse(iso);

describe('wrangler.jsonc', () => {
  it('registers exactly the crons schedule.ts dispatches on', () => {
    const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(cfg).toContain(`"crons": ["${SCRAPE_CRON}", "${MORNING_CRON}", "${ALERTS_CRON}"]`);
  });
});

describe('scrape cron', () => {
  it('dispatches all four scrape workflows (Glasgow included)', () => {
    expect(dueWorkflows(SCRAPE_CRON, at('2026-10-21T06:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
  });
  it('adds the OpenStreetMap snapshot on Monday 11:00 UTC only (once a week)', () => {
    expect(dueWorkflows(SCRAPE_CRON, at('2026-11-02T11:00:00Z'))).toEqual([...SCRAPE_WORKFLOWS, OSM_WORKFLOW, REGISTER_WORKFLOW]);
    expect(dueWorkflows(SCRAPE_CRON, at('2026-11-02T23:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
    expect(dueWorkflows(SCRAPE_CRON, at('2026-11-03T11:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
  });
  it('the OpenStreetMap workflow file exists and can be dispatched', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${OSM_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
  });
  it('the venue register workflow file exists and can be dispatched', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${REGISTER_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
    expect(yml).toContain('ANTHROPIC_API_KEY');
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

describe('Brookings sports fetch', () => {
  it('fires once a day, on the first alerts tick of 17:00 UTC', () => {
    const fired = [];
    for (let h = 0; h < 24; h++) for (const m of ['00', '15', '30', '45']) fired.push(...dueWorkflows(ALERTS_CRON, at(`2026-11-09T${String(h).padStart(2, '0')}:${m}:00Z`)));
    expect(fired).toEqual([SPORTS_WORKFLOW]);
    expect(dueWorkflows(ALERTS_CRON, at('2026-11-09T17:00:00Z'))).toEqual([SPORTS_WORKFLOW]);
  });
  it('never shares an hour with the scrape ticks (a sports run never overlaps a scrape)', () => {
    const scrapeHours = SCRAPE_CRON.split(' ')[1].split(',').map(Number);
    expect(scrapeHours).not.toContain(SPORTS_UTC_HOUR);
  });
  it('the workflow file exists, is dispatchable, and does not use --even-if-disabled', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${SPORTS_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
    expect(yml).toContain('python -m sports.runner --town brookings_sd');
    expect(yml).not.toContain('even-if-disabled');
  });
});
