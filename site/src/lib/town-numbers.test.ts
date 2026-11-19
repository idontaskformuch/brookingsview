import { describe, it, expect } from 'vitest';
import {
  NUMBERS_WEEKS, weekOf, weekOfDay, weekStartDay, fullWeeks, countByWeek, coveredSeries, lineValues, insightLine, weeklyRow,
  closureWeekSpans, lastFullMonth, pickRows, readWithin, INSIGHT_NOUNS, type NumberRow,
} from './town-numbers';
import { sparkNumberHtml, sparklineHtml } from './ui/ui-html';

// Real rows (live DB, SELECT 2026-11-19). Weekly counts = published event stories per local Monday-first week (America/Chicago),
// stories source_type 'event', published, not superseded, by occurs_at:
// brookings_sd 2026-07-06 .. 2026-11-09:
const BROOKINGS_WEEKS: [string, number][] = [
  ['2026-07-06', 5], ['2026-07-13', 2], ['2026-07-20', 2], ['2026-07-27', 1], ['2026-08-03', 4], ['2026-08-10', 11], ['2026-08-17', 14],
  ['2026-08-24', 7], ['2026-08-31', 3], ['2026-09-07', 17], ['2026-09-14', 11], ['2026-09-21', 18], ['2026-09-28', 14], ['2026-10-05', 15],
  ['2026-10-12', 9], ['2026-10-19', 14], ['2026-10-26', 9], ['2026-11-02', 10], ['2026-11-09', 14],
];
const CHI = 'America/Chicago';
const dayOf = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
const weekIdx = (ymd: string) => weekOfDay(dayOf(ymd));
/** The 12 weeks ending with the week starting `lastYmd`, with their counts. */
function window12(lastYmd: string) {
  const end = BROOKINGS_WEEKS.findIndex(([w]) => w === lastYmd);
  const slice = BROOKINGS_WEEKS.slice(end - NUMBERS_WEEKS + 1, end + 1);
  return { weeks: slice.map(([w]) => weekIdx(w)), counts: slice.map(([, n]) => n) };
}
const allRead = (weeks: number[]) => ({ firstReadWeek: weeks[0] - 10, readWeeks: new Set(weeks) });

describe('local Monday-first weeks', () => {
  it('a Monday starts a week and the Sunday before ends the previous one', () => {
    expect(weekStartDay(weekIdx('2026-11-09'))).toBe(dayOf('2026-11-09'));
    expect(weekIdx('2026-11-15')).toBe(weekIdx('2026-11-09'));
    expect(weekIdx('2026-11-16')).toBe(weekIdx('2026-11-09') + 1);
  });
  it('buckets by the town clock, not UTC (event-303556, Jazz at Lincoln Center Orchestra, 2026-10-12 00:00 UTC = Sun 11 Oct 7 pm CDT)', () => {
    expect(weekOf('2026-10-12T00:00:00Z', CHI)).toBe(weekIdx('2026-10-05'));
    expect(weekOf('2026-10-12T00:00:00Z', 'UTC')).toBe(weekIdx('2026-10-12'));
  });
  it('the 12 full weeks end with the week before the current one (build Thu 19 Nov 2026)', () => {
    const w = fullWeeks(new Date('2026-11-19T14:00:00Z'), CHI);
    expect(w).toHaveLength(NUMBERS_WEEKS);
    expect(w[0]).toBe(weekIdx('2026-08-24'));
    expect(w[11]).toBe(weekIdx('2026-11-09'));
  });
});

describe('coverage (D1)', () => {
  it('Brookings events 24 Aug - 9 Nov: every week read and non-empty, so the line shows', () => {
    const { weeks, counts } = window12('2026-11-09');
    expect(counts).toEqual([7, 3, 17, 11, 18, 14, 15, 9, 14, 9, 10, 14]);
    const s = coveredSeries(counts, weeks, { ...allRead(weeks), zeroIsGap: true });
    expect(lineValues(s)).toEqual(counts);
  });
  it('Moreno Valley events, August 2026: the scraper read every week but no event occurs 3 Aug - 6 Sep -> gaps, not zeros, no line', () => {
    // moreno_valley_ca weekly counts (America/Los_Angeles) 2026-08-24 .. 2026-11-09; scrape_runs events status ok in every week.
    const ymds = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
    const weeks = ymds.map(weekIdx);
    const counts = [0, 2, 9, 10, 7, 5, 8, 7, 8, 6, 4, 8];
    const s = coveredSeries(counts, weeks, { ...allRead(weeks), zeroIsGap: true });
    expect(s[0]).toBeNull();
    expect(s[11]).toBe(8);
    expect(lineValues(s)).toBeNull();
  });
  it('Glasgow events: first read 22 Oct 2026 -> only 26 Oct, 2 Nov and 9 Nov are full covered weeks', () => {
    const now = new Date('2026-11-19T14:00:00Z');
    const weeks = fullWeeks(now, 'Europe/London');
    const counts = weeks.map((w) => (w === weekIdx('2026-10-26') ? 12 : w === weekIdx('2026-11-02') ? 6 : w === weekIdx('2026-11-09') ? 8 : w === weekIdx('2026-10-19') ? 4 : 0));
    const first = weekOf('2026-10-22T16:25:31Z', 'Europe/London');
    const s = coveredSeries(counts, weeks, { firstReadWeek: first, readWeeks: new Set(weeks.filter((w) => w >= first)), zeroIsGap: true });
    expect(s.filter((v) => v != null)).toEqual([12, 6, 8]); // the week of the first read (19 Oct, 4 events) is partial
    expect(lineValues(s)).toBeNull();
  });
  it('a week without a successful read is a gap even with rows; a zero is a real 0 where zeroIsGap is off (closures, jobs)', () => {
    const { weeks } = window12('2026-11-09');
    const reads = new Set(weeks.filter((_, i) => i !== 3));
    const s = coveredSeries([1, 0, 2, 5, 0, 0, 1, 0, 0, 3, 0, 1], weeks, { firstReadWeek: weeks[0] - 1, readWeeks: reads });
    expect(s[3]).toBeNull();
    expect(s[1]).toBe(0);
  });
  it('Broomfield events: first read Fri 13 Nov 2026 -> the week 9-15 Nov is partial, so last week is not covered', () => {
    const weeks = fullWeeks(new Date('2026-11-19T14:00:00Z'), 'America/Denver');
    const first = weekOf('2026-11-13T12:00:00Z', 'America/Denver');
    const s = coveredSeries(countByWeek([], weeks), weeks, { firstReadWeek: first, readWeeks: new Set([first]), zeroIsGap: true });
    expect(s[11]).toBeNull();
  });
});

describe('insight lines (D5), on real Brookings event weeks', () => {
  const nouns = INSIGHT_NOUNS.events;
  it('latest week ties a week inside the stretch -> no line (window ending 9 Nov: 14 after 14 on 19 Oct)', () => {
    const { weeks, counts } = window12('2026-11-09');
    expect(insightLine(counts, weeks, nouns, 'en-US')).toBeNull();
  });
  it('the last higher week in the same month as the latest week -> no line (window ending 19 Oct: 14 > 9, last higher is 15 on 5 Oct)', () => {
    const { weeks, counts } = window12('2026-10-19');
    expect(counts).toEqual([4, 11, 14, 7, 3, 17, 11, 18, 14, 15, 9, 14]);
    expect(insightLine(counts, weeks, nouns, 'en-US')).toBeNull();
  });
  it('quietest since August (window ending 12 Oct: 9 is below 15, 14, 18, 11, 17; the last lower week is 31 Aug with 3)', () => {
    const { weeks, counts } = window12('2026-10-12');
    expect(counts).toEqual([1, 4, 11, 14, 7, 3, 17, 11, 18, 14, 15, 9]);
    expect(insightLine(counts, weeks, nouns, 'en-US')).toBe('Quietest event week since August');
  });
  it('a record for all the data gives no line (window ending 21 Sep: 18 is the highest of the 12 weeks)', () => {
    const { weeks, counts } = window12('2026-09-21');
    expect(counts).toEqual([5, 2, 2, 1, 4, 11, 14, 7, 3, 17, 11, 18]);
    expect(insightLine(counts, weeks, nouns, 'en-US')).toBeNull();
  });
  it('one changed field: 19 Oct at 13 instead of 14 makes 9 Nov (14) the busiest since 5 Oct (15) -> "since October"', () => {
    const { weeks, counts } = window12('2026-11-09');
    const c = [...counts];
    c[8] = 13; // the only edited value (real: 14)
    expect(insightLine(c, weeks, nouns, 'en-US')).toBe('Busiest event week since October');
  });
  it('no percentages or trend words in any noun', () => {
    for (const n of Object.values(INSIGHT_NOUNS)) for (const s of Object.values(n)) expect(s).not.toMatch(/%|up|down|rising|falling|trend/i);
  });
});

describe('rows', () => {
  const row = (id: NumberRow['id']): NumberRow => ({ id, label: id, value: 1, href: '/', line: null, span: null, insight: null });
  it('order events, closures, jobs, meetings, decisions; at most four; fewer than two -> none', () => {
    expect(pickRows([row('decisions'), row('jobs'), row('meetings'), row('events'), row('closures')]).map((r) => r.id))
      .toEqual(['events', 'closures', 'jobs', 'meetings']);
    expect(pickRows([row('meetings'), null])).toEqual([]);
  });
  it('trend off (Moreno Valley closures, D3): the number stays, line and insight go', () => {
    const { weeks, counts } = window12('2026-10-12');
    const r = weeklyRow({ id: 'events', label: 'Events last week', value: 9, href: '/events/', span: 's', series: counts, weeks, trend: false, locale: 'en-US' });
    expect(r.line).toBeNull();
    expect(r.insight).toBeNull();
    const on = weeklyRow({ id: 'events', label: 'Events last week', value: 9, href: '/events/', span: 's', series: counts, weeks, trend: true, locale: 'en-US' });
    expect(on.insight).toBe('Quietest event week since August');
  });
  it('a number without a line has the same row markup as one with a line (D2)', () => {
    const a = sparkNumberHtml({ label: 'Events last week', value: 8 });
    const b = sparklineHtml({ values: [12, 6, 8], label: 'Events last week' });
    for (const cls of ['ui-spark"', 'ui-spark__text', 'ui-spark__value', 'ui-spark__label', 'ui-spark__alt', 'ui-spark__svg']) {
      expect(a).toContain(cls);
      expect(b).toContain(cls);
    }
    expect(a).toContain('Events last week: 8.');
    expect(a).not.toContain('<svg');
  });
});

describe('closures per week', () => {
  it('a closure counts in every local week it was listed (Broomfield #4176, US-36E, 24 Oct 06:00 UTC - 26 Oct 00:01 UTC = Sat-Sun MDT)', () => {
    const w = closureWeekSpans([{ created_at: '2026-10-24T06:00:53Z', last_seen_at: '2026-10-26T00:01:26Z' }], 'America/Denver');
    expect(w).toEqual([weekIdx('2026-10-19')]);
    const utc = closureWeekSpans([{ created_at: '2026-10-24T06:00:53Z', last_seen_at: '2026-10-26T00:01:26Z' }], 'UTC');
    expect(utc).toEqual([weekIdx('2026-10-19'), weekIdx('2026-10-26')]);
  });
});

describe('month and freshness', () => {
  it('last full month at 19 Nov 2026 is October; in January it is the previous December', () => {
    expect(lastFullMonth(new Date('2026-11-19T14:00:00Z'), CHI, 'en-US')).toEqual({ y: 2026, m: 10, name: 'October' });
    expect(lastFullMonth(new Date('2027-01-05T14:00:00Z'), CHI, 'en-US')).toEqual({ y: 2026, m: 12, name: 'December' });
  });
  it('jobs hidden after 7 days without a read (Glasgow: last ok read before 19 Nov was 22 Oct 2026)', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(readWithin('2026-10-22T16:25:31Z', now, 7)).toBe(false);
    expect(readWithin('2026-11-18T23:01:27Z', new Date('2026-11-19T14:00:00Z'), 7)).toBe(true);
    expect(readWithin(null, now, 7)).toBe(false);
  });
});
