import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGroups, closedPlaces, countHeld, holidayOverviewLine, isTimeless, timelessGroups, timelessHero, detailFor, FOLD_AFTER, GROUP_HEADING, GROUP_ORDER, groupSources, holidayHero, holidayInsights, regularHoursRows,
} from './holiday-view';
import { occurrenceDay } from './holiday-calendar';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import { buildVeteransDayPage } from '../config/holiday-pages/veterans-day';
import { buildThanksgivingPage } from '../config/holiday-pages/thanksgiving';
import { buildChristmasPage } from '../config/holiday-pages/christmas';
import { buildTimelessHolidayMeta, type HolidayPageData } from './holiday-page';

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

  it('Broomfield Veterans Day: Closed (4), Changed (police), Events, Check before you go; no Open group without data', () => {
    const g = buildGroups(vet, '2026-11-06');
    expect(g.map((x) => x.id)).toEqual(['closed', 'changed', 'events', 'unconfirmed']);
    expect(g[0].rows.map((r) => r.name)).toEqual(['City offices', 'Combined Courts', 'inventHQ', 'Library']);
    expect(g[0].rows.every((r) => r.pill?.text === 'Closed' && r.pill.tone === 'alert')).toBe(true);
    expect(g[0].rows[1].parts[0]).toBe('Nov 11.');
    expect(g[1].rows[0].name).toMatch(/^Police Department/);
    expect(g[1].rows[0].pill).toEqual({ tone: 'warn', text: 'Changed' });
    // F9 (2026-11-11): a not-yet-posted row is a plain link to the place's page, with no "Not confirmed" pill.
    expect(g[3].heading).toBe('Check before you go');
    expect(g[3].rows.every((r) => r.pill === null && !!r.href)).toBe(true);
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
    expect(lib.href ?? lib.check?.url).toBeTruthy();
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
    // F9 (2026-11-11): the hero said "2 places closed" for Thanksgiving, but Tree Branch closes Sat Nov 28.
    expect(closedPlaces(bfThanks)).toBe(2); // any day: Tree Branch Recycle, FISH food bank
    expect(closedPlaces(bfThanks, '2026-11-26')).toBe(1); // on Thanksgiving: FISH food bank only
    // Owner 2026-11-11: no number while the city's own closures row is unconfirmed (holdsCount); the weekday is the hero.
    expect(countHeld(bfThanks)).toBe(true);
    expect(holidayHero(bfThanks, 'Thanksgiving', day('thanksgiving', bfThanks), '2026-11-11').value).toBe('Thursday');
    const cityConfirmed: HolidayPageData = { ...bfThanks, facts: bfThanks.facts.filter((f) => !f.holdsCount) };
    expect(holidayHero(cityConfirmed, 'Thanksgiving', day('thanksgiving', bfThanks), '2026-11-11').value).toBe(1);
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

/** /holidays/ (F9, 2026-11-11): one sentence of what is shut on the day, from the confirmed rows; none without a closure. */
describe('holidayOverviewLine', () => {
  it('Thanksgiving: no line while the city row is unconfirmed; then only what is shut on Nov 26 (Tree Branch closes Nov 28)', () => {
    expect(holidayOverviewLine(bfThanks, holidayPageDef('thanksgiving')!, day('thanksgiving', bfThanks))).toBeNull();
    const cityConfirmed: HolidayPageData = { ...bfThanks, facts: bfThanks.facts.filter((f) => !f.holdsCount) };
    expect(holidayOverviewLine(cityConfirmed, holidayPageDef('thanksgiving')!, day('thanksgiving', bfThanks))).toBe('Closed: Broomfield FISH food bank.');
  });

  it('Veterans Day after the day (owner 2026-11-11): no insight line, no "Check before you go", past tense in rows and event', () => {
    const dayIso = '2026-11-11';
    expect(holidayInsights(vet, true)).toEqual([]);
    const g = buildGroups(vet, '2026-11-12', dayIso);
    expect(g.map((x) => x.id)).not.toContain('unconfirmed');
    const text = g.flatMap((x) => x.rows.flatMap((r) => r.parts)).join(' ');
    expect(text).toContain('Operations ran 24/7 on Nov 11. The front desk was not staffed');
    expect(text).toContain('provided refreshments');
    expect(text).not.toMatch(/\b(run|is|are|connects|provide)\b 24\/7|front desk is not|provide refreshments/);
    // On the day itself nothing changes.
    expect(buildGroups(vet, dayIso, dayIso).map((x) => x.id)).toContain('unconfirmed');
  });
  it('a holiday whose next date is in a later year names the season the rows describe', () => {
    const next = occurrenceDay(holidayPageDef('veterans-day')!, vet.year + 1);
    expect(holidayOverviewLine(vet, holidayPageDef('veterans-day')!, next)).toBe('Closed in 2026: City offices, Combined Courts, inventHQ and Library.');
  });
  it('no confirmed closure, no sentence', () => {
    expect(holidayOverviewLine(xmas, holidayPageDef('christmas')!, day('christmas', xmas))).toBeNull();
  });
});

/** Owner 2026-11-11: the standing page (outside the window, last season's facts) is timeless -- what the day is, what is normally
 *  closed according to the source, the next date -- and says nothing in the past tense. */
describe('standing (timeless) page', () => {
  const PAST = /\b(was|were|ran|held|provided|took place|happened)\b/i;
  const next = occurrenceDay(holidayPageDef('veterans-day')!, vet.year + 1);
  it('is timeless only when the facts are for an earlier season than the next date', () => {
    expect(isTimeless(vet, 2027)).toBe(true);
    expect(isTimeless(vet, 2026)).toBe(false);
    expect(isTimeless(vet, null)).toBe(false);
  });
  it('Veterans Day after Nov 11: next date in the hero, normally closed/different rows without dates, no events', () => {
    const hero = timelessHero('Veterans Day', next);
    expect(hero).toEqual({ value: 'Thursday', label: 'Veterans Day is', sub: 'Thursday, Nov 11, 2027' });
    const g = timelessGroups(vet);
    expect(g.map((x) => x.heading)).toEqual(['Normally closed', 'Normally different']);
    expect(g[0].rows.map((r) => r.name)).toEqual(['City offices', 'Combined Courts', 'inventHQ', 'Library']);
    const text = [hero.label, hero.sub, ...g.flatMap((x) => [x.heading, ...x.rows.flatMap((r) => [r.name, r.pill?.text ?? '', ...r.parts])])].join(' ');
    expect(text).not.toMatch(PAST);
    expect(text).not.toMatch(/Nov 11\b(?!, 2027)/);
  });
  it('regression: the dated view the standing page used to show reads as past events', () => {
    const old = [holidayHero(vet, 'Veterans Day', day('veterans-day', vet), '2026-11-12').label,
      ...buildGroups(vet, '2026-11-12', '2026-11-11').flatMap((x) => x.rows.flatMap((r) => [r.pill?.text ?? '', ...r.parts]))].join(' ');
    expect(old).toMatch(PAST);
  });
});

describe('buildTimelessHolidayMeta', () => {
  it('names what is normally closed and the next date; no year in the title, no past tense', () => {
    const m = buildTimelessHolidayMeta(vet, 'Veterans Day', 'Broomfield', occurrenceDay(holidayPageDef('veterans-day')!, 2027));
    expect(m.title).toBe('Veterans Day in Broomfield: closures');
    expect(m.description).toBe('What is normally closed or different in Broomfield on Veterans Day. Next Veterans Day: Thursday, November 11, 2027.');
    expect(m.description).not.toMatch(/\b(was|were|ran|held)\b/);
  });
});
