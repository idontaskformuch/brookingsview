import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGroups, closedPlaces, countHeld, holidayOverviewLine, isTimeless, timelessGroups, detailFor, FOLD_AFTER, GROUP_HEADING, GROUP_ORDER, groupSources, holidayStatus, holidayInsights, closureGrid, regularHoursRows, statusDay, shortHourRange,
} from './holiday-view';
import { occurrenceDay, resolvePageState } from './holiday-calendar';
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
/** Broomfield's Thanksgiving page as it stood until 2026-11-17: the city's closures row exactly as in thanksgiving.ts at
 *  a27a273 (unconfirmed, holdsCount, a link to the News Flash), in place of the rows its notice then confirmed. */
const bfCityPending: HolidayPageData = {
  ...bfThanks,
  facts: [
    {
      section: 'closures', status: 'unconfirmed', label: 'City offices, courts, library and recreation centers', holdsCount: true,
      source: { name: 'City and County of Broomfield: News Flash', url: 'https://www.broomfield.org/CivicAlerts.aspx?CID=-1' }, checkedOn: '2026-11-11',
      checkAt: { label: 'City and County of Broomfield News Flash', url: 'https://www.broomfield.org/CivicAlerts.aspx?CID=-1' },
    },
    ...bfThanks.facts.filter((f) => f.source.name !== 'City and County of Broomfield: CCOB Closures and Adjusted Hours for Thanksgiving'),
  ],
};
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
      // rows with `days` are in the closures grid instead (Tillägg B): together nothing is lost
      const gridRows = closureGrid(page)?.groups.reduce((n, x) => n + x.rows.length, 0) ?? 0;
      const rowCount = g.reduce((n, x) => n + x.rows.length, 0) + gridRows;
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

  it('an unconfirmed row keeps its pointer: where to check, and no 2025/26 times', () => {
    const rows = buildGroups(xmas, '2026-11-06').find((g) => g.id === 'unconfirmed')!.rows;
    expect(rows.length).toBeGreaterThan(FOLD_AFTER);
    // Glasgow Life's festive hours and the council's office hours are still 2025/26: plain links, no times (owner 2026-11-14).
    const reg = rows.find((r) => r.name === 'Registrars')!;
    expect(reg.lastYear).toBeUndefined();
    expect(reg.parts).toEqual([]);
    expect(reg.href).toBe('https://www.glasgow.gov.uk/article/11458');
    const lib = rows.find((r) => r.name.startsWith('Libraries'))!;
    expect(lib.lastYear).toBeUndefined();
    expect(lib.parts).toEqual([]);
    expect(lib.href).toBe('https://www.glasgowlife.org.uk/festive-opening-hours/libraries-and-community-venues-festive-opening-hours');
  });

  it('a long group folds after FOLD_AFTER rows (8), in the component, not by cutting data', () => {
    expect(FOLD_AFTER).toBe(8);
    expect(read('../components/HolidayRows.astro')).toMatch(/slice\(0, FOLD_AFTER\)[\s\S]*<details/);
  });
});

describe('closures grid (Tillägg B, owner 2026-11-20)', () => {
  // Broomfield Thanksgiving (bfThanks): the city's Nov 16 notice + Tree Branch + FISH, `days` written from each row's value.
  const g = closureGrid(bfThanks)!;
  it('one column per affected day, from the data', () => {
    expect(g.days.map((d) => d.label)).toEqual(['Wed 25', 'Thu 26', 'Fri 27', 'Sat 28']);
  });
  it('more than 6 places -> City services / Recreation / Food & help', () => {
    expect(g.groups.map((x) => [x.heading, x.rows.map((r) => r.name)])).toEqual([
      ['City services', ['City offices', 'Combined Courts', 'inventHQ', 'Library', 'Depot Museum', 'RV Waste Disposal Station', 'Tree Branch Recycle and RV Wastewater Disposal Facility']],
      ['Recreation', ['Broomfield Community Center', 'Paul Derda Recreation Center']],
      ['Food & help', ['Broomfield FISH food bank']],
    ]);
  });
  it('cells: Closed / hours that day / usual hours, never a made-up "Open"', () => {
    const cells = (name: string) => g.groups.flatMap((x) => x.rows).find((r) => r.name === name)!.cells.map((c) => `${c.kind}:${c.text}`);
    // "Open 9 a.m.–5 p.m. Wed Nov 25. Closed Thu Nov 26 and Fri Nov 27."
    expect(cells('Library')).toEqual(['hours:9 a.m.–5 p.m.', 'closed:Closed', 'closed:Closed', 'usual:Usual hours']);
    // "Closed Thu Nov 26, open for 8 a.m. group fitness classes only. Open 8 a.m.–2 p.m. Fri Nov 27."
    expect(cells('Broomfield Community Center')).toEqual(['usual:Usual hours', 'hours:8 a.m. group fitness only', 'hours:8 a.m.–2 p.m.', 'usual:Usual hours']);
    // Tree Branch is shut Thu/Fri every week (Wed + Sat only): "Usual hours", not "Open".
    expect(cells('Tree Branch Recycle and RV Wastewater Disposal Facility')).toEqual(['usual:Usual hours', 'usual:Usual hours', 'usual:Usual hours', 'closed:Closed']);
    expect(JSON.stringify(g)).not.toMatch(/"Open"/);
  });
  it('QA data.holiday-grid-phone-label: a usual cell says "Usual" on a phone card, "Usual hours" on desktop', () => {
    // Broomfield Thanksgiving, Tree Branch (real row): three usual days. At 390px "Usual / hours" wrapped onto two lines.
    const tb = g.groups.flatMap((x) => x.rows).find((r) => r.name === 'Tree Branch Recycle and RV Wastewater Disposal Facility')!;
    expect(tb.cells.filter((c) => c.kind === 'usual').map((c) => [c.text, c.short])).toEqual([['Usual hours', 'Usual'], ['Usual hours', 'Usual'], ['Usual hours', 'Usual']]);
    const src = read('../components/HolidayDayGrid.astro');
    expect(src).toMatch(/hg__short/);
    expect(src).toMatch(/@media \(max-width: 40rem\)[\s\S]*\.hg__long \{ display: none; \}[\s\S]*\.hg__short \{ display: inline; \}/);
  });
  it('QA data.holiday-grid-phone-hours: an hours range is "9–5" on a phone card, the full text on desktop', () => {
    // Broomfield Thanksgiving real rows: at 390px "9 a.m.–5 p.m." wrapped onto two lines.
    const rows = g.groups.flatMap((x) => x.rows);
    const hours = (name: string) => rows.find((r) => r.name === name)!.cells.filter((c) => c.kind === 'hours').map((c) => [c.text, c.short]);
    expect(hours('Library')).toEqual([['9 a.m.–5 p.m.', '9–5']]);
    expect(hours('Broomfield Community Center')).toEqual([['8 a.m. group fitness only', undefined], ['8 a.m.–2 p.m.', '8–2']]);
    expect(hours('Paul Derda Recreation Center')).toEqual([['12–6:30 p.m.', '12–6:30']]);
    // Library row, only the time changed: a half hour keeps its minutes; a noon-crossing range whose bare numbers would
    // read as one half of the day ("7–9") keeps a.m./p.m.; text that is not one range is untouched.
    expect(shortHourRange('9:30 a.m.–5 p.m.')).toBe('9:30–5');
    expect(shortHourRange('7 a.m.–9 p.m.')).toBe('7 a.m.–9 p.m.');
    expect(shortHourRange('10 a.m.–12 p.m.')).toBe('10–12');
    expect(shortHourRange('Closes 5 p.m.')).toBe('Closes 5 p.m.');
  });
  it('one "Checked" for the grid: the newest row check, not a span', () => {
    expect(g.checked).toBe('2026-11-17');
  });
  it('grid rows leave the Closed list; the police row (changed, no days) stays in Schedule changes', () => {
    const groups = buildGroups(bfThanks, '2026-11-20', '2026-11-26');
    expect(groups.find((x) => x.id === 'closed')).toBeUndefined();
    expect(groups.find((x) => x.id === 'changed')!.rows.map((r) => r.name)).toContain('Police Department Building and Detention Center');
  });
  it('a page without `days` has no grid and keeps its Closed list (Broomfield Veterans Day)', () => {
    expect(closureGrid(vet)).toBeNull();
    expect(buildGroups(vet, '2026-11-01', '2026-11-11').some((x) => x.id === 'closed')).toBe(true);
  });
  it('Moreno Thanksgiving: RTA (Nov 12 release) no buses Thu 26; the library (tockify 304264/304267) Wed 25 closes 5 p.m., Thu 26 + Fri 27 closed', () => {
    const mg = closureGrid(mvThanks)!;
    expect(mg.days.map((d) => d.label)).toEqual(['Wed 25', 'Thu 26', 'Fri 27']);
    expect(mg.groups[0].rows.map((r) => [r.name, r.cells.map((c) => `${c.kind}:${c.text}`)])).toEqual([
      ['RTA buses', ['usual:Regular schedule', 'closed:Closed', 'usual:Regular schedule']],
      ['Library (all locations)', ['hours:Closes 5 p.m.', 'closed:Closed', 'closed:Closed']],
    ]);
    expect(mg.checked).toBe('2026-11-14');
    expect(buildGroups(mvThanks, '2026-11-20', '2026-11-26').find((x) => x.id === 'closed')).toBeUndefined();
  });
  it('Brookings Thanksgiving: three places, Thu 26 + Fri 27, no grouping, the closed list empties', () => {
    // City Holidays page (offices Thu), Landfill and Collections Calendar (landfill Thu), SDSU events 21522/21523 (McCrory Thu + Fri).
    const bg = closureGrid(bkThanks)!;
    expect(bg.days.map((d) => d.label)).toEqual(['Thu 26', 'Fri 27']);
    expect(bg.groups.map((x) => x.heading)).toEqual([null]);
    const rows = bg.groups[0].rows.map((r) => [r.name, r.cells.map((c) => c.kind).join(',')]);
    expect(rows).toEqual([['City offices', 'closed,usual'], ['Landfill', 'closed,usual'], ['McCrory Gardens', 'closed,closed']]);
    expect(bg.groups[0].rows.find((r) => r.name === 'Landfill')!.note).toBe('Sat Nov 28 is the last Saturday open for the season.');
    expect(bg.checked).toBe('2026-10-24');
    expect(buildGroups(bkThanks, '2026-11-20', '2026-11-26').find((x) => x.id === 'closed')?.rows.map((r) => r.name) ?? []).not.toContain('City offices');
  });
  it('transit rows (section, not name) say "Regular schedule" / "Regular" (owner 2026-11-20)', () => {
    // Moreno Thanksgiving, RTA buses (Nov 12 release): "Buses run on a regular schedule Wed Nov 25 and Fri Nov 27."
    const rta = closureGrid(mvThanks)!.groups[0].rows.find((r) => r.name === 'RTA buses')!;
    expect(rta.cells.filter((c) => c.kind === 'usual').map((c) => [c.text, c.short])).toEqual([['Regular schedule', 'Regular'], ['Regular schedule', 'Regular']]);
    // The same real row with only `section` changed to 'closures': the label follows the type, not the name "RTA buses".
    const asClosure = { ...mvThanks, facts: mvThanks.facts.map((f) => (f.label === 'RTA buses' ? { ...f, section: 'closures' as const } : f)) };
    const r2 = closureGrid(asClosure)!.groups[0].rows.find((r) => r.name === 'RTA buses')!;
    expect(r2.cells.map((c) => c.text)).toEqual(['Usual hours', 'Closed', 'Usual hours']);
  });
  it('legend "Usual = no change announced by the source." above the grid only when a cell says Usual hours', () => {
    // Brookings: City offices Fri 27 is usual (the City Holidays page lists only Thanksgiving Day, re-read 2026-11-20).
    expect(closureGrid(bkThanks)!.legend).toBe('Usual = no change announced by the source.');
    expect(closureGrid(bfThanks)!.legend).toBe('Usual = no change announced by the source.');
    // Moreno: the library row names every day and RTA says "Regular schedule": no Usual cell, no legend.
    expect(closureGrid(mvThanks)!.legend).toBeNull();
    const src = read('../components/HolidayDayGrid.astro');
    expect(src.indexOf('grid.legend')).toBeGreaterThan(-1);
    expect(src.indexOf('grid.legend')).toBeLessThan(src.indexOf('role="table"'));
  });
  it('the template renders the grid without a <table>, with day labels for the phone cards', () => {
    const src = read('../components/HolidayDayGrid.astro');
    expect(src).not.toMatch(/<table|<td\b|<th\b/);
    expect(src).toMatch(/role="table"/);
    expect(src).toMatch(/@media \(max-width: 40rem\)/);
    expect(read('../components/HolidayPage.astro')).toMatch(/<HolidayDayGrid grid=\{grid\}/);
  });
});

describe('Christmas closures grids (owner 2026-11-21)', () => {
  it('Broomfield: FISH, the one confirmed closure, Dec 24, Dec 25 and Jan 1; the month is shown across the year end', () => {
    // FISH page (read 2026-11-14): "Thursday, December 24th", "Friday, December 25th", "Friday, January 1st".
    const g = closureGrid(buildChristmasPage('broomfield_co')!)!;
    expect(g.days.map((d) => d.label)).toEqual(['Thu Dec 24', 'Fri Dec 25', 'Fri Jan 1']);
    expect(g.groups).toEqual([{ heading: null, rows: [{ name: 'Broomfield FISH food bank', note: 'Questions about access to food: 303-465-1600 or help@broomfieldfish.org.', cells: [{ kind: 'closed', text: 'Closed' }, { kind: 'closed', text: 'Closed' }, { kind: 'closed', text: 'Closed' }] }] }]);
    expect(g.legend).toBeNull();
  });
  it('Brookings: City offices and Landfill Dec 25 + Jan 1, McCrory also Dec 24; Christmas Eve is usual where the source is silent', () => {
    const g = closureGrid(buildChristmasPage('brookings_sd')!)!;
    expect(g.days.map((d) => d.label)).toEqual(['Thu Dec 24', 'Fri Dec 25', 'Fri Jan 1']);
    const rows = g.groups.flatMap((x) => x.rows);
    expect(rows.map((r) => [r.name, r.cells.map((c) => c.text)])).toEqual([
      ['City offices', ['Usual hours', 'Closed', 'Closed']],
      ['Landfill', ['Usual hours', 'Closed', 'Closed']],
      ['McCrory Gardens', ['Closed', 'Closed', 'Closed']],
    ]);
    // City Holidays page: "in most cases"; it does not name Christmas Eve.
    expect(rows[0].note).toBe('Closed "in most cases", the city says.');
    expect(g.legend).toBe('Usual = no change announced by the source.');
  });
  it('Moreno: RTA (transit: Regular schedule Dec 24, as the source says) and the Library; no Usual cell, no legend', () => {
    const g = closureGrid(buildChristmasPage('moreno_valley_ca')!)!;
    expect(g.days.map((d) => d.label)).toEqual(['Thu Dec 24', 'Fri Dec 25', 'Fri Jan 1']);
    const rows = g.groups.flatMap((x) => x.rows);
    expect(rows.map((r) => [r.name, r.cells.map((c) => c.text)])).toEqual([
      ['RTA buses', ['Regular schedule', 'Closed', 'Closed']],
      ['Library (all locations)', ['Closed', 'Closed', 'Closed']],
    ]);
    // RTA 2026-2027 Holiday Schedule: "free rides after 2:30 p.m. on Dec 31" has no column, so it stands under the name.
    expect(rows[0].note).toBe('Free rides after 2:30 p.m. Thu Dec 31. The Customer Information Center, (951) 565-5002, is closed Dec 25 and Jan 1.');
    expect(g.legend).toBeNull();
  });
});

describe('hero and insights', () => {
  it('status line, not a display number (Tillägg A, owner 2026-11-20): weekday, date and how far away', () => {
    // Broomfield Thanksgiving (bfThanks, Nov 26) seen on 2026-11-20: the owner's own example.
    expect(holidayStatus(day('thanksgiving', bfThanks), '2026-11-20')).toBe('Thursday, Nov 26 · 6 days away');
    expect(holidayStatus(day('thanksgiving', bfThanks), '2026-11-25')).toBe('Thursday, Nov 26 · tomorrow');
    expect(holidayStatus(day('thanksgiving', bfThanks), '2026-11-26')).toBe('Thursday, Nov 26 · today');
    // after the day: counted back, never "away"; the year only when the day is in another year than today
    expect(holidayStatus(day('thanksgiving', bfThanks), '2026-11-27')).toBe('Thursday, Nov 26 · yesterday');
    expect(holidayStatus(day('veterans-day', vet), '2026-11-20')).toBe('Wednesday, Nov 11 · 9 days ago');
    expect(holidayStatus(day('thanksgiving', bfThanks), '2027-01-04')).toBe('Thursday, Nov 26, 2026 · 39 days ago');
    // Glasgow Christmas (xmas, en-GB) on 2026-11-20: the owner's "Friday, Dec 25 · 35 days away" in British order.
    expect(holidayStatus(day('christmas', xmas), '2026-11-20', 'en-GB')).toBe('Friday 25 Dec · 35 days away');
  });
  it('the page prints the status line, not HeroStat with "places closed" or a bare weekday', () => {
    const src = read('../components/HolidayPage.astro');
    expect(src).toMatch(/data-holiday-status>\{status\}/);
    expect(src).not.toMatch(/<HeroStatb/);
  });
  it('counts places that are shut, not pickups or trains that do not run', () => {
    expect(closedPlaces(bkThanks)).toBe(3); // City offices, Landfill, McCrory Gardens (SDSU calendar, added 2026-11-14)
    // F9 (2026-11-11): the hero said "2 places closed" for Thanksgiving, but Tree Branch closes Sat Nov 28. The city notice
    // (pasted 2026-11-17) adds its offices, courts, inventHQ, library, two rec centers, the Depot Museum and the RV station.
    expect(closedPlaces(bfThanks)).toBe(10); // any day: the 8 below + Depot Museum (Nov 27) + Tree Branch Recycle (Nov 28)
    // on Thanksgiving: City offices, Combined Courts, inventHQ, Library, Broomfield Community Center, Paul Derda Recreation
    // Center, RV Waste Disposal Station, FISH food bank. The police row is `changed` (runs 24/7), not closed.
    expect(closedPlaces(bfThanks, '2026-11-26')).toBe(8);
    // Owner 2026-11-11: no number while the city's own closures row is unconfirmed (holdsCount).
    expect(countHeld(bfThanks)).toBe(false);
    expect(countHeld(bfCityPending)).toBe(true);
    // Moreno: the library (calendar rows, 2026-11-14); the RTA row is closed too, but a bus that does not run is not a place.
    expect(closedPlaces(mvThanks)).toBe(1);
  });
  it('insight lines come from the data and exist only where the data has one', () => {
    expect(holidayInsights(vet)).toEqual(['Police run 24/7 on Nov 11; the front desk is not staffed.']);
    expect(holidayInsights(mvThanks)).toEqual(['Trash pickup is one day late after Thanksgiving Day.']);
    expect(holidayInsights(bfThanks)).toEqual([]);
    expect(holidayInsights(bkThanks)).toEqual(['Thursday recycling is picked up Wed Nov 25.']); // no yard waste after Nov 24 (owner 2026-11-15)
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
  it('two pages that would show the same name are one entry, linked to the first (owner 2026-11-14)', () => {
    // Moreno's two Farm House Collective calendar rows (events 329806 and 332324), each with its own event page.
    const mv = buildThanksgivingPage('moreno_valley_ca')!;
    const fh = (url: string, name: string, date: string) => ({
      status: 'confirmed' as const, name, date, venue: { name: 'Farm House Collective', locality: 'Riverside' }, url,
      source: { name: 'Farm House Collective', url }, checkedOn: '2026-11-13',
    });
    const page = { ...mv, events: [
      fh('https://farmhousecollective.com/event/a-charlie-brown-thanksgiving-fantastic-mr-fox-outdoor-screening/', 'A Charlie Brown Thanksgiving + Fantastic Mr. Fox Outdoor Screening', '2026-11-24'),
      fh('https://farmhousecollective.com/event/christmas-tree-lighting/', 'Christmas Tree Lighting', '2026-11-28'),
    ] };
    const farm = groupSources(page).filter((s) => s.name === 'Farm House Collective');
    expect(farm).toEqual([{ name: 'Farm House Collective', href: 'https://farmhousecollective.com/event/a-charlie-brown-thanksgiving-fantastic-mr-fox-outdoor-screening/' }]);
  });
  it('Moreno library: one library calendar row, 5 p.m. close Nov 25 and Closed Nov 26-27, nothing left to check', () => {
    const mv = buildThanksgivingPage('moreno_valley_ca')!;
    const lib = mv.facts.filter((f) => f.source.name === 'Moreno Valley Public Library calendar');
    expect(lib.map((f) => [f.status, f.status === 'confirmed' ? f.change : null, f.status === 'confirmed' ? f.value : null, f.checkedOn, f.source.url])).toEqual([
      ['confirmed', 'closed', 'Closes at 5 p.m. Wed Nov 25. Closed Thu Nov 26 and Fri Nov 27.', '2026-10-03', 'https://moval.gov/mv-library/'],
    ]);
    expect(mv.facts.some((f) => f.status === 'unconfirmed' && /library/i.test(f.label))).toBe(false);
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
    expect(read('../components/HolidayRow.astro')).not.toMatch(/br\.sourceb|checkedOn/);
  });
  it('"Last checked" appears once, under the heading', () => {
    expect((read('../components/HolidayPage.astro').replace(/\/\*[\s\S]*?\*\//g, '').match(/Last checked/g) ?? []).length).toBe(1);
  });
});

/** /holidays/ (F9, 2026-11-11): one sentence of what is shut on the day, from the confirmed rows; none without a closure. */
describe('holidayOverviewLine', () => {
  it('Thanksgiving: no line while the city row is unconfirmed; then only what is shut on Nov 26 (Depot Nov 27, Tree Branch Nov 28)', () => {
    expect(holidayOverviewLine(bfCityPending, holidayPageDef('thanksgiving')!, day('thanksgiving', bfThanks))).toBeNull();
    expect(holidayOverviewLine(bfThanks, holidayPageDef('thanksgiving')!, day('thanksgiving', bfThanks))).toBe(
      'Closed: City offices, Combined Courts, inventHQ, Library, Broomfield Community Center, Paul Derda Recreation Center, RV Waste Disposal Station and Broomfield FISH food bank.',
    );
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
  it('QA data.holiday-status-passed-day: Broomfield Veterans Day (2026 data) on 2026-11-20 names the passed day until 2027 data is in', () => {
    // owner 2026-11-20: "Wednesday, Nov 11 · 9 days ago" until the page has next year's closures; then the next date and countdown.
    // Before the fix the standing page's status named the next date ("Thursday, Nov 11, 2027 · 356 days away").
    const def = holidayPageDef('veterans-day')!;
    const s = resolvePageState(def, vet.year, Date.parse('2026-11-20T19:00:00Z'), 'America/Denver');
    expect(s.kind).toBe('evergreen');
    const ev = s as Extract<typeof s, { kind: 'evergreen' }>;
    expect(ev.nextYear).toBe(2027);
    const shown = statusDay(occurrenceDay(def, vet.year), vet.year, ev.nextYear, ev.nextDay);
    expect(holidayStatus(shown, '2026-11-20')).toBe('Wednesday, Nov 11 · 9 days ago');
    // the same page once its data is for 2027 (only page.year changed): the next date and countdown
    expect(holidayStatus(statusDay(occurrenceDay(def, 2027), 2027, ev.nextYear, ev.nextDay), '2026-11-20')).toBe('Thursday, Nov 11, 2027 · 356 days away');
    // data two seasons old never counts back over a year: the next date
    expect(statusDay(occurrenceDay(def, 2025), 2025, ev.nextYear, ev.nextDay)).toBe(ev.nextDay);
    // inside the window (no next occurrence): the season's day
    expect(statusDay(occurrenceDay(def, 2026), 2026, null, null)).toBe(occurrenceDay(def, 2026));
    expect(read('../components/HolidayPage.astro')).toMatch(/holidayStatus\(\s*statusDay\(/);
  });
  it('Veterans Day after Nov 11: normally closed/different rows without dates, no events', () => {
    const hero = holidayStatus(next, '2026-11-20');
    expect(hero).toBe('Thursday, Nov 11, 2027 · 356 days away');
    const g = timelessGroups(vet);
    expect(g.map((x) => x.heading)).toEqual(['Normally closed', 'Normally different']);
    expect(g[0].rows.map((r) => r.name)).toEqual(['City offices', 'Combined Courts', 'inventHQ', 'Library']);
    const text = [hero, ...g.flatMap((x) => [x.heading, ...x.rows.flatMap((r) => [r.name, r.pill?.text ?? '', ...r.parts])])].join(' ');
    expect(text).not.toMatch(PAST);
    expect(text).not.toMatch(/Nov 11\b(?!, 2027)/);
  });
  it('regression: the dated view the standing page used to show reads as past events', () => {
    const old = [
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
