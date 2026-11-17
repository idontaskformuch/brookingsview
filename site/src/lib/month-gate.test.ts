/** Audit Fas 7a: the /month/ index gate (lib/month-gate.mjs). Every row below is a real row from the live DB (read 2026-11-17),
 *  id in the comment; only the fields the gate and classifier read are kept. */
import { describe, expect, it } from 'vitest';
import {
  MONTH_GATE_MINIMUMS, MIN_MODULES_FOR_INDEX, localMonthOf, rowsInMonth, gateCount, floorStatus, moduleClears,
  clearedModuleCount, clearedModuleKinds, monthGate, monthsFromStart, monthQueryWindow,
} from './month-gate.mjs';
import { trafficModuleFromRows, type MonthContext } from './month-in-review';

const LA = 'America/Los_Angeles';
const DENVER = 'America/Denver';
const CHICAGO = 'America/Chicago';

// Moreno Valley traffic_incidents created on Wed 30 Sep 2026 local time. 3510-3515 were created 2026-10-01T02:46Z = 7:46 PM
// PDT on 30 Sep -- the last-day-of-month case. All eleven are CHP rows outside the town boundary with no road, so
// classifyTrafficIncident() drops every one (3482 approach and 3509 in town, from the same day, are left out on purpose).
const MORENO_TRAFFIC_SEP30_DROPPED = [
  { id: 3465, road: null, lat: 34.000145, lon: -117.063085, created_at: '2026-09-30T11:29:07.253312Z' },
  { id: 3487, road: null, lat: 34.066071, lon: -117.328079, created_at: '2026-09-30T17:07:03.323768Z' },
  { id: 3488, road: null, lat: 33.981008, lon: -117.340892, created_at: '2026-09-30T17:07:03.323768Z' },
  { id: 3505, road: null, lat: 34.063105, lon: -117.418204, created_at: '2026-09-30T21:36:33.698145Z' },
  { id: 3506, road: null, lat: 33.804538, lon: -117.133461, created_at: '2026-09-30T21:36:33.698145Z' },
  { id: 3510, road: null, lat: 33.982607, lon: -117.342294, created_at: '2026-10-01T02:46:27.431585Z' },
  { id: 3511, road: null, lat: 33.796518, lon: -117.230969, created_at: '2026-10-01T02:46:27.431585Z' },
  { id: 3512, road: null, lat: 34.063788, lon: -117.286662, created_at: '2026-10-01T02:46:27.431585Z' },
  { id: 3513, road: null, lat: 33.942978, lon: -117.281534, created_at: '2026-10-01T02:46:27.431585Z' },
  { id: 3514, road: null, lat: 33.947062, lon: -117.299906, created_at: '2026-10-01T02:46:27.431585Z' },
  { id: 3515, road: null, lat: 34.07203, lon: -117.295717, created_at: '2026-10-01T02:46:27.431585Z' },
];
const MORENO_TRAFFIC_FLOOR = '2026-08-10T14:21:03.011725Z'; // MIN(created_at), moreno_valley_ca
// Moreno's corridors + range as in site-config.ts (the rows above have no road, so only the boundary decides).
const MORENO_CORRIDORS = [{ label: 'I-215', numbers: ['215'] }, { label: 'SR-60', numbers: ['60'] }];

// Moreno Valley project_updates since August 2026 (id, project slug, entry_date); floor MIN(entry_date) 2026-05-29T01:00Z.
const MORENO_PROJECT_UPDATES = [
  { id: 48, project_slug: 'brodiaea-residential-development', entry_date: '2026-08-14T01:00:00Z' },
  { id: 46, project_slug: 'edgemont-commerce-center', entry_date: '2026-08-14T01:00:00Z' },
  { id: 47, project_slug: 'cactus-indian-convenience-store-fueling-car-wash', entry_date: '2026-08-14T01:00:00Z' },
  { id: 50, project_slug: 'village-specific-plan-204-amendment', entry_date: '2026-08-19T01:00:00Z' },
  { id: 53, project_slug: 'self-storage-indian-alessandro', entry_date: '2026-09-02T01:00:00Z' },
  { id: 26, project_slug: 'aquabella-tract-map-39549', entry_date: '2026-09-25T01:00:00Z' },
  { id: 57, project_slug: 'brodiaea-residential-development', entry_date: '2026-11-18T02:00:00Z' },
];
const MORENO_PROJECTS_FLOOR = '2026-05-29T01:00:00Z';

const sep2026Moreno: MonthContext = { year: 2026, month: 9, timezone: LA, meetingsHaveTime: true };

describe('month gate: local calendar month, not UTC (owner 2026-11-17, decision 1)', () => {
  it('a row late on the last local day of the month belongs to that month', () => {
    // broomfield_co traffic_incidents 2361 "1 Vehicle Crash on I-25S": 2026-09-01T03:40Z = 9:40 PM MDT Mon 31 Aug.
    expect(localMonthOf('traffic', '2026-09-01T03:40:14.845359Z', DENVER, true)).toEqual({ y: 2026, m: 8 });
    // moreno_valley_ca jobs 4652 "Clinical Supervisor, BCBA" (Accel Therapies): 2026-10-01T02:46Z = 7:46 PM PDT Wed 30 Sep.
    const job = { title: 'Clinical Supervisor, BCBA', company: 'Accel Therapies', created_at: '2026-10-01T02:46:27.431585Z' };
    expect(rowsInMonth('jobs', [job], 2026, 9, LA, true)).toEqual([job]);
    expect(rowsInMonth('jobs', [job], 2026, 10, LA, true)).toEqual([]);
  });

  it("Brookings' bare Legistar meeting date stays on its calendar day (no zone shift to the previous evening)", () => {
    // brookings_sd meetings 13337, meeting_date 2026-10-01T00:00Z, 6 decisions: Thu 1 Oct, not Wed 30 Sep in Chicago.
    const decisions = Array.from({ length: 6 }, () => ({ meeting_date: '2026-10-01T00:00:00Z' }));
    expect(rowsInMonth('decisions', decisions, 2026, 10, CHICAGO, false)).toHaveLength(6);
    expect(rowsInMonth('decisions', decisions, 2026, 9, CHICAGO, false)).toHaveLength(0);
  });

  it('the query window reaches a day beyond the UTC month on both sides', () => {
    const { start, end } = monthQueryWindow(2026, 9);
    expect(start.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(new Date('2026-10-01T02:46:27.431585Z') < end).toBe(true);
  });

  it('pages exist for every month from the start up to, not including, the local current month', () => {
    expect(monthsFromStart('moreno_valley_ca', LA, new Date('2026-11-17T12:00:00Z')))
      .toEqual([{ year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }]);
    // 2026-11-01T06:00Z is still Sat 31 Oct in Moreno Valley: October is not complete yet.
    expect(monthsFromStart('moreno_valley_ca', LA, new Date('2026-11-01T06:00:00Z')))
      .toEqual([{ year: 2026, month: 8 }, { year: 2026, month: 9 }]);
    expect(monthsFromStart('broomfield_co', DENVER, new Date('2026-11-17T12:00:00Z'))).toEqual([]);
  });
});

describe('month gate: traffic counts the rows before classification (decision 2)', () => {
  it('eleven dropped rows still clear the traffic minimum while the page shows 0 in town', () => {
    const mod = trafficModuleFromRows(MORENO_TRAFFIC_SEP30_DROPPED, MORENO_TRAFFIC_FLOOR, sep2026Moreno,
      'moreno_valley_ca', MORENO_CORRIDORS, 8);
    expect(mod.inTown).toBe(0);
    expect(mod.approach).toBe(0);
    expect(mod.gateCount).toBe(11);
    expect(moduleClears('traffic', mod.status, mod.gateCount)).toBe(true);
  });

  it('read in UTC, the six evening rows would fall into October and September would not clear', () => {
    const utcSeptember = MORENO_TRAFFIC_SEP30_DROPPED.filter((r) => r.created_at.startsWith('2026-09'));
    expect(utcSeptember).toHaveLength(5);
    expect(moduleClears('traffic', 'full', utcSeptember.length)).toBe(false);
  });

  it('one row under the minimum does not count', () => {
    const nine = MORENO_TRAFFIC_SEP30_DROPPED.slice(0, MONTH_GATE_MINIMUMS.traffic - 1);
    const mod = trafficModuleFromRows(nine, MORENO_TRAFFIC_FLOOR, sep2026Moreno, 'moreno_valley_ca', MORENO_CORRIDORS, 8);
    expect(mod.gateCount).toBe(9);
    expect(moduleClears('traffic', mod.status, mod.gateCount)).toBe(false);
  });
});

describe('month gate: source exists, 0 rows', () => {
  it('Moreno projects in October 2026: source running since May, no update in the month -> does not count', () => {
    expect(floorStatus('projects', MORENO_PROJECTS_FLOOR, 2026, 10, LA, true)).toBe('full');
    const october = rowsInMonth('projects', MORENO_PROJECT_UPDATES, 2026, 10, LA, true);
    expect(gateCount('projects', october)).toBe(0);
    expect(moduleClears('projects', 'full', 0)).toBe(false);
  });

  it('projects count distinct projects: August has 4, September 2 (= the minimum)', () => {
    expect(gateCount('projects', rowsInMonth('projects', MORENO_PROJECT_UPDATES, 2026, 8, LA, true))).toBe(4);
    expect(gateCount('projects', rowsInMonth('projects', MORENO_PROJECT_UPDATES, 2026, 9, LA, true))).toBe(2);
    expect(MONTH_GATE_MINIMUMS.projects).toBe(2);
  });

  it('a module whose source had not started never counts, whatever the count', () => {
    expect(floorStatus('traffic', MORENO_TRAFFIC_FLOOR, 2026, 7, LA, true)).toBe('none');
    expect(moduleClears('traffic', 'none', 50)).toBe(false);
    expect(floorStatus('traffic', MORENO_TRAFFIC_FLOOR, 2026, 8, LA, true)).toBe('partial');
  });
});

describe('month gate: the whole verdict', () => {
  it('owner minimums are the ones in force', () => {
    expect(MONTH_GATE_MINIMUMS).toEqual({ decisions: 5, projects: 2, sales: 15, events: 10, traffic: 10, jobs: 20 });
    expect(MIN_MODULES_FOR_INDEX).toBe(4);
  });

  it('monthGate and clearedModuleCount agree; fewer than four cleared modules stay noindex', () => {
    const data = {
      projects: { rows: MORENO_PROJECT_UPDATES, floor: MORENO_PROJECTS_FLOOR },
      traffic: { rows: MORENO_TRAFFIC_SEP30_DROPPED, floor: MORENO_TRAFFIC_FLOOR },
    };
    const gate = monthGate(data, 2026, 9, LA, true);
    expect(gate.modules.projects).toEqual({ status: 'full', gateCount: 2 });
    expect(gate.modules.traffic).toEqual({ status: 'full', gateCount: 11 });
    expect(gate.modules.decisions).toEqual({ status: 'none', gateCount: 0 });
    expect(gate.cleared).toBe(2);
    expect(gate.indexable).toBe(false);
    expect(clearedModuleCount(gate.modules)).toBe(2);
  });

  it('a module under its minimum is neither shown nor counted: 0 rows and under the minimum alike (owner 2026-11-17)', () => {
    const data = {
      projects: { rows: MORENO_PROJECT_UPDATES, floor: MORENO_PROJECTS_FLOOR },
      traffic: { rows: MORENO_TRAFFIC_SEP30_DROPPED.slice(0, MONTH_GATE_MINIMUMS.traffic - 1), floor: MORENO_TRAFFIC_FLOOR },
    };
    // October: projects source running, 0 updates -> hidden.
    const october = monthGate(data, 2026, 10, LA, true);
    expect(october.modules.projects).toEqual({ status: 'full', gateCount: 0 });
    expect(clearedModuleKinds(october.modules)).not.toContain('projects');
    // September: projects 2 (shown); traffic 9 rows, one under the minimum (hidden).
    const september = monthGate(data, 2026, 9, LA, true);
    expect(september.modules.traffic).toEqual({ status: 'full', gateCount: 9 });
    expect(clearedModuleKinds(september.modules)).toEqual(['projects']);
    expect(clearedModuleKinds(september.modules)).toHaveLength(september.cleared);
  });
});
