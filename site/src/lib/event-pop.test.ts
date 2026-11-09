import { describe, expect, it } from 'vitest';
import { dayTile, isOverToday, relativeDayLabel, relativeDayLabelForDate } from './event-pop';
import { applyEventPop } from './event-pop-client';
import { academicKind } from './academic-kind';

const CHI = 'America/Chicago';
const LON = 'Europe/London';

describe('dayTile', () => {
  it('a single day: weekday and month in capitals above the day number, in the town\'s zone', () => {
    // 01:30 UTC on the 12th is the evening of the 11th in Chicago: the tile follows the town, not UTC
    expect(dayTile('2026-11-12T01:30:00Z', null, CHI, 'us')).toMatchObject({ kind: 'single', kicker: 'WED · NOV', day: '11', span: null });
    expect(dayTile('2026-11-12T19:00:00Z', '2026-11-12T21:00:00Z', CHI, 'us')).toMatchObject({ kind: 'single', kicker: 'THU · NOV', day: '12' });
  });
  it('a range inside one month: the month above, "25–29" below', () => {
    expect(dayTile('2026-11-25T12:00:00Z', '2026-11-29T12:00:00Z', CHI, 'us')).toMatchObject({ kind: 'range', kicker: 'NOV', day: '25–29' });
  });
  it('a range over a month boundary is one smaller line, country order', () => {
    expect(dayTile('2026-12-31T12:00:00Z', '2027-01-02T12:00:00Z', CHI, 'us')).toMatchObject({ kind: 'cross', kicker: null, day: '', span: 'DEC 31 – JAN 2' });
    expect(dayTile('2026-12-31T12:00:00Z', '2027-01-02T12:00:00Z', LON, 'gb').span).toBe('31 DEC – 2 JAN');
  });
  it('an end on the same local day is not a range', () => {
    expect(dayTile('2026-11-12T19:00:00-06:00', '2026-11-12T22:30:00-06:00', CHI, 'us').kind).toBe('single');
    expect(dayTile('2026-11-12T19:00:00-06:00', '2026-11-12T19:00:00-06:00', CHI, 'us').kind).toBe('single');
  });
  it('has a plain-text reading for assistive technology', () => {
    expect(dayTile('2026-11-25T12:00:00Z', '2026-11-29T12:00:00Z', CHI, 'us').label).toBe('Nov 25 to Nov 29');
    expect(dayTile('2026-11-12T19:00:00Z', null, LON, 'gb').label).toBe('Thu 12 Nov');
  });
});

describe('relative day label', () => {
  const NOW = new Date('2026-11-09T13:00:00Z'); // Mon 07:00 in Chicago
  it('Today, Tomorrow, In N days up to 6, then nothing', () => {
    const at = (iso: string) => relativeDayLabel(iso, NOW, CHI);
    expect(at('2026-11-09T23:00:00Z')).toBe('Today');
    expect(at('2026-11-10T20:00:00Z')).toBe('Tomorrow');
    expect(at('2026-11-12T20:00:00Z')).toBe('In 3 days');
    expect(at('2026-11-15T20:00:00Z')).toBe('In 6 days');
    expect(at('2026-11-16T20:00:00Z')).toBeNull();
    expect(at('2026-11-08T20:00:00Z')).toBeNull(); // yesterday is gone
  });
  it('counts calendar days in the town\'s zone, not 24-hour blocks', () => {
    const lateEvening = new Date('2026-11-10T04:30:00Z'); // 22:30 Monday in Chicago
    expect(relativeDayLabel('2026-11-10T14:00:00Z', lateEvening, CHI)).toBe('Tomorrow'); // 08:00 Tuesday: 9.5 hours away, one calendar day
    expect(relativeDayLabel('2026-11-10T03:00:00Z', lateEvening, CHI)).toBe('Today'); // 21:00 Monday
  });
  it('works for plain calendar dates too', () => {
    expect(relativeDayLabelForDate('2026-11-11', NOW, CHI)).toBe('In 2 days');
    expect(relativeDayLabelForDate('2026-11-09', NOW, CHI)).toBe('Today');
    expect(relativeDayLabelForDate('garbage', NOW, CHI)).toBeNull();
  });
});

describe('isOverToday', () => {
  const NOW = new Date('2026-11-09T22:00:00Z'); // 16:00 Chicago
  it('dims an item that started and ended earlier today only', () => {
    expect(isOverToday({ start: '2026-11-09T15:00:00Z', end: '2026-11-09T17:00:00Z' }, NOW, CHI)).toBe(true);
    expect(isOverToday({ start: '2026-11-09T15:00:00Z', end: '2026-11-09T23:30:00Z' }, NOW, CHI)).toBe(false); // still on
    expect(isOverToday({ start: '2026-11-10T15:00:00Z', end: '2026-11-10T17:00:00Z' }, NOW, CHI)).toBe(false); // another day
    expect(isOverToday({ start: '2026-11-08T15:00:00Z', end: '2026-11-08T17:00:00Z' }, NOW, CHI)).toBe(false); // yesterday is not listed at all
  });
});

/** The smallest Document the client function needs: rows with a dataset, a class list and one label slot. */
function row(dataset: Record<string, string>) {
  const slot = { textContent: '', hidden: true };
  const classes = new Set<string>();
  return { el: { dataset, querySelector: () => slot, classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } }, slot, classes };
}
const docOf = (...rows: ReturnType<typeof row>[]) => ({ querySelectorAll: () => rows.map((r) => r.el) }) as unknown as Document;

describe('applyEventPop', () => {
  const NOW = new Date('2026-11-09T22:00:00Z');
  it('writes the label, shows the slot, dims what is over today and leaves its label empty', () => {
    const soon = row({ start: '2026-11-11T15:00:00Z' });
    const over = row({ start: '2026-11-09T15:00:00Z', end: '2026-11-09T17:00:00Z' });
    const far = row({ start: '2026-12-01T15:00:00Z' });
    const dated = row({ day: '2026-11-10' });
    applyEventPop(docOf(soon, over, far, dated), NOW, CHI);
    expect([soon.slot.textContent, soon.slot.hidden]).toEqual(['In 2 days', false]);
    expect([over.slot.textContent, over.slot.hidden, [...over.classes]]).toEqual(['', true, ['is-over']]);
    expect([far.slot.textContent, far.slot.hidden]).toEqual(['', true]);
    expect([dated.slot.textContent]).toEqual(['Tomorrow']);
  });
});

describe('academicKind (every title in academic_calendar_dates on 2026-11-09)', () => {
  const free = ['Labor Day holiday', 'Native American Day holiday', "Veterans' Day holiday", 'Thanksgiving recess', 'No classes; final exam preparation',
    'Martin Luther King Day holiday', "Presidents' Day holiday", 'Spring break', 'Easter recess'];
  const deadline = ['Last day to drop or add and adjust final fees', "Fall tuition and fees payment due; 'W' grade begins", 'Last day to submit a graduation application for fall 2026',
    'Midterm grades due', 'Last day to drop a course', 'Fall grades due', 'Last day to submit a graduation application for spring 2027', 'Spring grades due'];
  const neutral = ['Fall classes begin', 'First half fall term ends', 'Fall final exams', 'Spring classes begin', 'First half spring term ends', 'Spring final exams', 'Commencement'];
  it.each(free)('day off: %s', (t) => expect(academicKind(t)).toBe('free'));
  it.each(deadline)('deadline: %s', (t) => expect(academicKind(t)).toBe('deadline'));
  it.each(neutral)('neutral: %s', (t) => expect(academicKind(t)).toBeNull());
  it('a title that matches both kinds stays neutral', () => {
    expect(academicKind('Last day of classes before Thanksgiving recess')).toBeNull();
  });
});
