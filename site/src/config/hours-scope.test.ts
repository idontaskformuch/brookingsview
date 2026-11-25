import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNCONFIRMED_HOURS, unconfirmedHoursSlugs } from './hours-scope';

// Owner order D (2026-11-25): Broomfield Auditorium's hand-entered Mon-Fri 10-18 rows are hidden until a source confirms them.
describe('UNCONFIRMED_HOURS', () => {
  it('hides broomfield_co/broomfield-auditorium and nothing in the other towns', () => {
    expect(unconfirmedHoursSlugs('broomfield_co')).toEqual(['broomfield-auditorium']);
    expect(unconfirmedHoursSlugs('brookings_sd')).toEqual([]);
    expect(unconfirmedHoursSlugs('no_such_town')).toEqual([]);
  });

  it('names the source that has to confirm each entry', () => {
    for (const town of Object.values(UNCONFIRMED_HOURS)) {
      for (const e of Object.values(town)) expect(e.confirmWith).toMatch(/^https:\/\//);
    }
  });

  it('both place_hours queries in lib/db.ts leave the listed places out', () => {
    const src = readFileSync(fileURLToPath(new URL('../lib/db.ts', import.meta.url)), 'utf-8');
    for (const fn of ['getAllPlaceHoursForTown', 'getPlaceHours']) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`)).split('\n}\n')[0];
      expect(body, fn).toContain('unconfirmedHoursSlugs(TOWN_ID)');
    }
  });
});
