import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALERTS_CRON } from '../src/alerts/towns';
import { FACILITY_HOURS_WORKFLOW, GLASGOW_SPORTS_WORKFLOW, MORNING_BUILDS, MORNING_CRON, OSM_WORKFLOW, REGISTER_WORKFLOW, SCRAPE_CRON, SCRAPE_WORKFLOWS, SPORTS_UTC_HOUR, SPORTS_WORKFLOW, TRAFFIC_UTC_HOURS, TRAFFIC_WORKFLOW, dueWorkflows } from '../src/schedule';

const dueWorkflowsAll = dueWorkflows;

const at = (iso: string) => Date.parse(iso);

describe('wrangler.jsonc', () => {
  it('registers exactly the crons schedule.ts dispatches on', () => {
    const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(cfg).toContain(`"crons": ["${SCRAPE_CRON}", "${MORNING_CRON}", "${ALERTS_CRON}"]`);
  });
});

describe('scrape cron', () => {
  it('dispatches all four scrape workflows (Glasgow included)', () => {
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-10-21T06:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
  });
  it('adds the OpenStreetMap snapshot on Monday and Thursday 11:00 UTC, the venue register on Monday only', () => {
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-11-02T11:00:00Z'))).toEqual([...SCRAPE_WORKFLOWS, OSM_WORKFLOW, REGISTER_WORKFLOW, FACILITY_HOURS_WORKFLOW]);
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-11-02T23:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-11-03T11:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-11-05T11:00:00Z'))).toEqual([...SCRAPE_WORKFLOWS, OSM_WORKFLOW]);
    expect(dueWorkflowsAll(SCRAPE_CRON, at('2026-11-05T23:00:00Z'))).toEqual(SCRAPE_WORKFLOWS);
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
  it('the facility-hours workflow exists, can be dispatched and never gets a model key (llm_excluded sources)', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${FACILITY_HOURS_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
    expect(yml).not.toContain('ANTHROPIC_API_KEY');
  });
  it('unknown cron dispatches nothing', () => {
    expect(dueWorkflowsAll('* * * * *', at('2026-10-21T06:00:00Z'))).toEqual([]);
  });
});

describe('morning closure-watch', () => {
  const CHI = 'closure-watch-morning.yml';
  const LA = 'moval-closure-watch-morning.yml';
  // The forced builds (own describe below) share the cron; these tests are about the closure-watch runs only.
  const dueWorkflows = (cron: string, t: number) => dueWorkflowsAll(cron, t).filter((w) => w.includes('closure-watch'));

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

  it('Broomfield has no closure-watch workflow (school_alerts sources disabled)', () => {
    const all = ['10', '11', '12', '13'].flatMap((h) => dueWorkflows(MORNING_CRON, at(`2026-10-21T${h}:30:00Z`)));
    expect(all.some((w) => w.includes('broomfield'))).toBe(false);
  });
});

describe('forced morning build (owner 2026-11-24)', () => {
  const MOVAL = 'moval-deploy.yml';
  const BROOM = 'broomfield-deploy.yml';
  const GLA = 'glasgow-deploy.yml';
  const BROOK = 'deploy.yml';
  const builds = (day: string) =>
    ['04', '05', '06', '10', '11', '12', '13'].flatMap((h) => dueWorkflowsAll(MORNING_CRON, at(`${day}T${h}:30:00Z`)).filter((w) => !w.includes('closure-watch')).map((w) => `${h}:${w}`));

  it('every dispatched workflow exists and can be dispatched', () => {
    for (const { workflow } of MORNING_BUILDS) {
      expect(readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8')).toContain('workflow_dispatch');
    }
  });
  it('summer (DST): Glasgow 04:30Z (BST), Broomfield 11:30Z (MDT), Moreno 12:30Z (PDT) on a Saturday', () => {
    expect(builds('2026-07-18')).toEqual([`04:${GLA}`, `10:${BROOK}`, `11:${BROOM}`, `12:${MOVAL}`]);
  });
  it('winter: Glasgow 05:30Z (GMT), Broomfield 12:30Z (MST), Moreno 13:30Z (PST) on a Sunday', () => {
    expect(builds('2026-12-20')).toEqual([`05:${GLA}`, `11:${BROOK}`, `12:${BROOM}`, `13:${MOVAL}`]);
  });
  it('on a weekday Moreno is covered by moval-closure-watch-morning.yml, never also by moval-deploy.yml (no double deploy)', () => {
    expect(builds('2026-07-15')).toEqual([`04:${GLA}`, `11:${BROOM}`]);
    expect(builds('2026-12-16')).toEqual([`05:${GLA}`, `12:${BROOM}`]);
    expect(dueWorkflowsAll(MORNING_CRON, at('2026-12-16T13:30:00Z'))).toEqual(['moval-closure-watch-morning.yml']);
  });
  it('on a weekday Brookings is covered by closure-watch-morning.yml, never also by deploy.yml (no double deploy)', () => {
    expect(dueWorkflowsAll(MORNING_CRON, at('2026-07-15T10:30:00Z'))).toEqual(['closure-watch-morning.yml']);
    expect(dueWorkflowsAll(MORNING_CRON, at('2026-12-16T11:30:00Z'))).toEqual(['closure-watch-morning.yml']);
  });
});

describe('Brookings sports fetch', () => {
  it('fires once a day, on the first alerts tick of 17:00 UTC', () => {
    const fired = [];
    for (let h = 0; h < 24; h++) for (const m of ['00', '15', '30', '45']) fired.push(...dueWorkflows(ALERTS_CRON, at(`2026-11-09T${String(h).padStart(2, '0')}:${m}:00Z`)));
    expect(fired.filter((w) => w !== TRAFFIC_WORKFLOW)).toEqual([SPORTS_WORKFLOW, GLASGOW_SPORTS_WORKFLOW]);
    expect(dueWorkflows(ALERTS_CRON, at('2026-11-09T17:00:00Z'))).toEqual([SPORTS_WORKFLOW, GLASGOW_SPORTS_WORKFLOW, TRAFFIC_WORKFLOW]);
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
  it('the Glasgow sports workflow is dispatchable, runs the runner for glasgow, takes the key from the secret and never prints it', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${GLASGOW_SPORTS_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
    expect(yml).toContain('python -m sports.runner --town glasgow');
    expect(yml).toContain('SPORTMONKS_API_KEY: ${{ secrets.SPORTMONKS_API_KEY }}');
    expect(yml).not.toContain('even-if-disabled');
    expect(yml).not.toMatch(/--dry-run|set -x|echo[^\n]*SPORTMONKS/);
    expect(yml).not.toMatch(/run:[^\n]*\$\{\{\s*secrets/); // a secret is only ever passed through env:, never spliced into a command line
  });
});

describe('Traffic read (owner Beslut 10, 2026-11-19)', () => {
  it('fires twice a day, on the first alerts tick of 05:00 and 17:00 UTC, and nowhere else', () => {
    const fired: string[] = [];
    for (let h = 0; h < 24; h++) for (const m of ['00', '15', '30', '45']) {
      if (dueWorkflows(ALERTS_CRON, at(`2026-11-09T${String(h).padStart(2, '0')}:${m}:00Z`)).includes(TRAFFIC_WORKFLOW)) fired.push(`${h}:${m}`);
    }
    expect(fired).toEqual(['5:00', '17:00']);
  });
  it('together with the scrape ticks the feeds are read every 6 hours, and never in a scrape hour', () => {
    const scrapeHours = SCRAPE_CRON.split(' ')[1].split(',').map(Number);
    for (const h of TRAFFIC_UTC_HOURS) expect(scrapeHours).not.toContain(h);
    expect([...scrapeHours, ...TRAFFIC_UTC_HOURS].sort((a, b) => a - b)).toEqual([5, 11, 17, 23]);
  });
  it('the workflow reads traffic only, for Moreno Valley and Broomfield, with no publish, build or deploy', () => {
    const yml = readFileSync(new URL(`../../.github/workflows/${TRAFFIC_WORKFLOW}`, import.meta.url), 'utf8');
    expect(yml).toContain('workflow_dispatch');
    expect(yml).toContain('--only traffic');
    expect(yml).toContain('town: moreno_valley_ca');
    expect(yml).toContain('town: broomfield_co');
    expect(yml).not.toMatch(/ai_pipeline|astro build|wrangler|npm ci/);
    expect(yml).not.toMatch(/run:[^\n]*\$\{\{\s*secrets/);
  });
});
