import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGroups, closedPlaces, detailFor, FOLD_AFTER, GROUP_HEADING, GROUP_ORDER, groupSources, holidayHero, holidayInsights, regularHoursRows,
} from './holiday-view';
import { occurrenceDay } from './holiday-calendar';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import { buildVeteransDayPage } from '../config/holiday-pages/veterans-day';
import { buildThanksgivingPage } from '../config/holiday-pages/thanksgiving';
import { buildChristmasPage } from '../config/holiday-pages/christmas';
import type { HolidayPageData } from './holiday-page';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MOVES = { south: [], north: [] };
const vet = buildVeteransDayPage('broomfield_co')!;
const bfThanks = buildThanksgivingPage('broomfield_co', MOVES)!;
const bkThanks = buildThanksgivingPage('brookings_sd', MOVES)!;
const mvThanks = buildThanksgivingPage('moreno_valley_ca', MOVES)!;
const xmas = buildChristmasPage('glasgow')!;
const ALL: [string, HolidayPageData][] = [['veterans', vet], ['broomfield', bfThanks], ['brookings', bkThanks], ['moreno', mvThanks], ['glasgow', xmas]];
const day = (slug: string, page: HolidayPageData) => occurrenceDay(holidayPageDef(slug)!, page.year);

describe('detailFor: the Closed pill already says Closed', () => {
  it('drops a leading "Closed" only when a date follows', () => {
    expect(detailFor('closed', 'Closed Nov 11.')).toBe('Nov 11.');
    expect(detailFor('closed', 'Closed Nov 11: George Di Ciero City and County Building.')).toBe('Nov 11: George Di Ciero City and County Building.');
    expect(detailFor('closed', 'Closed on Thu Nov 26. Sat is open.')).toBe('Thu Nov 26. Sat is open.');
    expect(detailFor('closed', 'Closed Sat Nov 28. Regular hours Wed 1–5 p.m.')).toBe('Sat Nov 28. Regular hours Wed 1–5 p.m.');
  });
  it('leaves everything else whole', () => {
    expect(detailFor('closed', 'Closed all day Thu Nov 26.')).toBe('Closed all day Thu Nov 26.');
    expect(detailFor('closed', 'Closed on Thanksgiving Day in most cases.')).toBe('Closed on Thanksgiving Day in most cases.');
    expect(detailFor('changed', 'Closed Nov 11.')).toBe('Closed Nov 11.');
    expect(detailFor(undefined, 'Closed Nov 11.')).toBe('Closed Nov 11.');
  });
});

describe('groups', () => {
  it('the middle group is called "Schedule changes" (owner 2026-11-06): it holds moved pickups and trains, not only hours', () => {
    expect(GROUP_HEADING.changed).toBe('Schedule changes');
    expect(buildGroups(vet, '2026-11-06').find((g) => g.id === 'changed')!.heading).toBe('Schedule changes');
  });

  it('Broomfield Veterans Day: Closed (4), Changed (police), Events, Not confirmed; no Open group without data', () => {
    const g = buildGroups(vet, '2026-11-06');
    expect(g.map((x) => x.id)).toEqual(['closed', 'changed', 'events', 'unconfirmed']);
    expect(g[0].rows.map((r) => r.name)).toEqual(['City offices', 'Combined Courts', 'inventHQ', 'Library']);
    expect(g[0].rows.every((r) => r.pill?.text === 'Closed' && r.pill.tone === 'alert')).toBe(true);
    expect(g[0].rows[1].parts[0]).toBe('Nov 11.');
    expect(g[1].rows[0].name).toMatch(/^Police Department/);
    expect(g[1].rows[0].pill).toEqual({ tone: 'warn', text: 'Changed' });
    expect(g[3].rows.every((r) => r.pill?.text === 'Not confirmed')).toBe(true);
  });

  it('groups come in the fixed order and are never empty; standing hours are not a group', () => {
    for (const [name, page] of ALL) {
      const g = buildGroups(page, '2026-11-06');
      const order = g.map((x) => GROUP_ORDER.indexOf(x.id));
      expect(order, name).toEqual([...order].sort((a, b) => a - b));
      for (const x of g) expect(x.rows.length, `${name}/${x.id}`).toBeGreaterThan(0);
      const rowCount = g.reduce((n, x) => n + x.rows.length, 0);
      expect(rowCount, name).toBe(page.facts.filter((f) => f.section !== 'hours').length + page.events.length);
      expect(regularHoursRows(page).length, name).toBe(page.facts.filter((f) => f.section === 'hours').length);
    }
  });

  it('every confirmed closure, trash and transit row says what it means (closed, changed or open), set in the data', () => {
    for (const [name, page] of ALL) {
      for (const f of page.facts) {
        if (f.status === 'confirmed' && ['closures', 'trash', 'transit'].includes(f.section)) expect(f.change, `${name}: ${f.label}`).toBeDefined();
      }
    }
  });

  it('a past event is labelled Held, a coming one has no pill', () => {
    const ev = buildGroups(vet, '2026-11-06').find((x) => x.id === 'events')!.rows[0];
    expect(ev.pill).toBeNull();
    expect(ev.href).toMatch(/^https:/);
    const after = buildGroups(vet, '2026-11-12').find((x) => x.id === 'events')!.rows[0];
    expect(after.pill).toEqual({ tone: 'neutral', text: 'Held November 11, 2026' });
  });

  it('only a row read before the page\'s newest check carries its own check date', () => {
    expect(buildGroups(vet, '2026-11-06').flatMap((g) => g.rows).every((r) => r.checkedNote === undefined)).toBe(true);
    const older = { ...vet, facts: vet.facts.map((f, i) => (i === 0 ? { ...f, checkedOn: '2026-10-30' } : f)) } as HolidayPageData;
    const rows = buildGroups(older, '2026-11-06').flatMap((g) => g.rows);
    expect(rows.filter((r) => r.checkedNote).map((r) => r.checkedNote)).toEqual(['Checked Oct 30, 2026']);
  });

  it('an unconfirmed row keeps its pointer: last season\'s value and source, and where to check', () => {
    const rows = buildGroups(xmas, '2026-11-06').find((g) => g.id === 'unconfirmed')!.rows;
    expect(rows.length).toBeGreaterThan(FOLD_AFTER);
    const lib = rows.find((r) => r.name.startsWith('Libraries'))!;
    expect(lib.lastYear?.text).toMatch(/^2025\/26: /);
    expect(lib.check?.url).toBeTruthy();
  });

  it('a long group folds after FOLD_AFTER rows (8), in the component, not by cutting data', () => {
    expect(FOLD_AFTER).toBe(8);
    expect(read('../components/HolidayRows.astro')).toMatch(/slice\(0, FOLD_AFTER\)[\s\S]*<details/);
  });
});

describe('hero and insights', () => {
  it('"Veterans Day is Wednesday" with the number of places closed', () => {
    expect(closedPlaces(vet)).toBe(4);
    expect(holidayHero(vet, 'Veterans Day', day('veterans-day', vet), '2026-11-06')).toEqual({
      value: 4, unit: 'places closed', label: 'Veterans Day is Wednesday', sub: 'Nov 11',
    });
  });
  it('one place reads "place closed"; after the day it reads "was" and carries the year', () => {
    const one = { ...vet, facts: vet.facts.filter((f) => f.status !== 'confirmed' || f.change !== 'closed' || f.label === 'Library') } as HolidayPageData;
    expect(holidayHero(one, 'Veterans Day', day('veterans-day', one), '2026-11-06').unit).toBe('place closed');
    expect(holidayHero(vet, 'Veterans Day', day('veterans-day', vet), '2026-11-12').label).toBe('Veterans Day 2026 was Wednesday');
  });
  it('without a confirmed closed place the weekday is the hero, never "0 places closed"', () => {
    expect(closedPlaces(xmas)).toBe(0);
    const h = holidayHero(xmas, 'Christmas', day('christmas', xmas), '2026-11-06');
    expect(h).toEqual({ value: 'Friday', label: 'Christmas is', sub: '25 Dec' });
    expect(JSON.stringify(h)).not.toMatch(/\b0\b/);
  });
  it('counts places that are shut, not pickups or trains that do not run', () => {
    expect(closedPlaces(bkThanks)).toBe(2); // City offices, Landfill
    expect(closedPlaces(bfThanks)).toBe(2); // Tree Branch Recycle, FISH food bank
    expect(closedPlaces(mvThanks)).toBe(0); // trash only
  });
  it('insight lines come from the data and exist only where the data has one', () => {
    expect(holidayInsights(vet)).toEqual(['Police run 24/7 on Nov 11; the front desk is not staffed.']);
    expect(holidayInsights(mvThanks)).toEqual(['Trash pickup is one day late after Thanksgiving Day.']);
    expect(holidayInsights(bfThanks)).toEqual([]);
    expect(holidayInsights(bkThanks)).toEqual(['Recycling and yard waste are picked up Wed Nov 25.']);
  });
});

describe('sources', () => {
  it('one entry per source page, named by the organization; pages of the same organization keep their page title', () => {
    const s = groupSources(vet);
    expect(new Set(s.map((x) => x.href)).size).toBe(s.length);
    expect(s.map((x) => x.name)).toContain('Broomfield FISH');
    expect(s.map((x) => x.name)).toContain('RTD');
    const bf = s.filter((x) => x.name.startsWith('City and County of Broomfield'));
    expect(bf.length).toBe(3);
    expect(new Set(bf.map((x) => x.name)).size).toBe(3);
  });
  it('every source on every page is listed exactly once', () => {
    for (const [name, page] of ALL) {
      const urls = [...page.facts.map((f) => f.source.url), ...page.events.map((e) => e.source.url)];
      expect(groupSources(page).map((x) => x.href).sort(), name).toEqual([...new Set(urls)].sort().concat(
        groupSources(page).map((x) => x.href).filter((h) => !urls.includes(h)),
      ).sort());
    }
  });
});

describe('the template', () => {
  it('has no table and no per-row source or "Checked" column', () => {
    for (const f of ['HolidayPage', 'HolidayRows', 'HolidayRow']) {
      const src = read(`../components/${f}.astro`).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/<table|<td|<th\b|<thead/);
    }
    expect(read('../components/HolidayRow.astro')).not.toMatch(/r\.source|checkedOn/);
  });
  it('"Last checked" appears once, under the heading', () => {
    expect((read('../components/HolidayPage.astro').replace(/\/\*[\s\S]*?\*\//g, '').match(/Last checked/g) ?? []).length).toBe(1);
  });
});
