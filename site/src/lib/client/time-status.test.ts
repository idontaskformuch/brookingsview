import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRelDays, daysFromToday, relWords } from './time-status';

const CHI = 'America/Chicago';

describe('daysFromToday: town-local calendar days, not 24-hour blocks', () => {
  it('00:30 local on the day itself is 0, though the UTC date is the day after', () => {
    expect(daysFromToday('2026-11-25', new Date('2026-11-25T06:30:00Z'), CHI)).toBe(0); // 00:30 CST
  });
  it('23:30 local the night before is 1 (UTC already says the 26th)', () => {
    expect(daysFromToday('2026-11-26', new Date('2026-11-25T05:30:00Z'), CHI)).toBe(2);
    expect(daysFromToday('2026-11-26', new Date('2026-11-26T05:30:00Z'), CHI)).toBe(1); // 23:30 CST on the 25th
  });
  it('a malformed date gives null', () => {
    expect(daysFromToday('Nov 26', new Date(), CHI)).toBeNull();
  });
});

describe('relWords', () => {
  it('in: today / tomorrow / in N days / yesterday / N days ago', () => {
    expect([0, 1, 5, -1, -9].map((n) => relWords(n, 'in'))).toEqual(['today', 'tomorrow', 'in 5 days', 'yesterday', '9 days ago']);
  });
  it('away: the holiday status line ("6 days away")', () => {
    expect([0, 1, 6, -1, -9].map((n) => relWords(n, 'away'))).toEqual(['today', 'tomorrow', '6 days away', 'yesterday', '9 days ago']);
  });
  it('day: Today / Tomorrow, any other day keeps the element text', () => {
    expect([0, 1, 2, -1].map((n) => relWords(n, 'day'))).toEqual(['Today', 'Tomorrow', null, null]);
  });
});

/** The smallest Document applyRelDays needs: elements with a dataset, text, a hidden flag and an optional scope. */
function el(dataset: Record<string, string>, text = '', hidden = true) {
  const scope = { hidden: false };
  return { dataset, textContent: text, hidden, scope, closest: (s: string) => (s === '[data-rel-scope]' ? scope : null) };
}
const docOf = (...els: ReturnType<typeof el>[]) => ({ querySelectorAll: () => els }) as unknown as Document;

describe('applyRelDays', () => {
  // Real rows: Glasgow /city-hall/ built 2026-11-25: Glasgow City Council, meeting 15198, 2026-12-10; Council and committees,
  // meeting 15128, 2026-11-26. Read on Wed 25 Nov at 15:00 in Glasgow.
  const LON = 'Europe/London';
  const NOW = new Date('2026-11-25T15:00:00Z');
  it('writes the words with the prefix and shows the element (it is hidden without JS)', () => {
    const council = el({ relDay: '2026-12-10', relPrefix: ' · ' });
    const tomorrow = el({ relDay: '2026-11-26' });
    expect(applyRelDays(docOf(council, tomorrow), NOW, LON)).toBe(2);
    expect(council.textContent).toBe(' · in 15 days');
    expect(council.hidden).toBe(false);
    expect(tomorrow.textContent).toBe('tomorrow');
  });
  it('the same page read after midnight says one day less (the build is never the clock)', () => {
    const council = el({ relDay: '2026-12-10' });
    applyRelDays(docOf(council), new Date('2026-11-26T00:05:00Z'), LON);
    expect(council.textContent).toBe('in 14 days');
  });
  it("style 'day' keeps the weekday beyond tomorrow and in the past", () => {
    const thu = el({ relDay: '2026-11-27', relStyle: 'day' }, 'Thursday', false);
    const today = el({ relDay: '2026-11-25', relStyle: 'day' }, 'Wednesday', false);
    applyRelDays(docOf(thu, today), NOW, LON);
    expect(thu.textContent).toBe('Thursday');
    expect(today.textContent).toBe('Today');
  });
  it('data-rel-past="hide" hides the scope once the day is over', () => {
    const past = el({ relDay: '2026-11-24', relPast: 'hide' });
    applyRelDays(docOf(past), NOW, LON);
    expect(past.scope.hidden).toBe(true);
  });
});

describe('wiring (Fas 3: no relative words computed at build)', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('BaseLayout runs applyRelDays on load and every minute', () => {
    const layout = read('../../layouts/BaseLayout.astro');
    expect(layout).toContain("import { applyRelDays } from '../lib/client/time-status'");
    expect(layout).toMatch(/setInterval\(\s*\(\)\s*=>\s*applyRelDays/);
  });
  it('no component prints relativeDays / holidayKicker / holidayStatus words at build', () => {
    for (const f of ['../../components/meetings/MeetingCard.astro', '../../components/meetings/MeetingLine.astro',
      '../../components/meetings/MeetingsUpcoming.astro', '../../components/rail/RailMeetings.astro', '../../components/rail/RailHoliday.astro',
      '../../components/HolidayPage.astro', '../home-blocks.ts', '../front-page.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/relativeDays\(|holidayKicker\(|holidayStatus\(/);
    }
  });
});
