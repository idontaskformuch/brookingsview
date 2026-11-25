import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { glanceCounts, glanceHtml, ymdOfDay, type GlanceEntry } from './events-glance';
import { localDayNumber } from '../local-day';

// Real rows: Glasgow /events/ built 2026-11-25 (data-start / data-end / the Free tag of each row, verbatim).
const LON = 'Europe/London';
const e = (start: string, end: string | null = null, free = false): GlanceEntry => ({ occ: [{ start, end }], ...(free ? { free: true } : {}) });
const HANSEL = e('2026-11-26T00:00:00.000Z', '2026-12-20T00:00:00.000Z'); // Hopscotch Theatre and Glasgow Life present Hansel & Gretel
const SOFT_PLAY = e('2026-11-26T09:30:00.000Z'); // Soft Play Music Mornings
const HONEY = e('2026-11-26T13:30:00.000Z'); // Honey Bees Knitting group
const SIGHT = e('2026-11-26T14:00:00.000Z'); // Sight Loss Group at Library @ the Bridge
const BOOKBUG = e('2026-11-26T17:30:00.000Z', null, true); // Bedtime Bookbug (Free)
const VINTAGE = e('2026-11-28T00:00:00.000Z', '2026-11-30T00:00:00.000Z', true); // Glasgow Vintage Vehicle Trust (Free)
const ART = e('2026-11-28T10:30:00.000Z'); // Saturday Art Club
const FAT_DOG = e('2026-11-28T19:00:00.000Z'); // Fat Dog
const ALL = [HANSEL, SOFT_PLAY, HONEY, SIGHT, BOOKBUG, VINTAGE, ART, FAT_DOG];
const opts = (now: Date) => ({ country: 'gb' as const, heroMin: 5, base: '', idPrefix: 'day', todayNo: localDayNumber(now, LON) });

describe('glanceCounts: counted for the moment the page is read, not the build', () => {
  it('Thu 26 Nov 10:00: five things on today, one tonight, one free', () => {
    const c = glanceCounts(ALL, new Date('2026-11-26T10:00:00Z'), LON);
    expect(c).toMatchObject({ today: 5, tonight: 1, free: 1 });
    expect(glanceHtml(c, opts(new Date('2026-11-26T10:00:00Z')))).toContain('ui-hero');
  });
  it('the same page at 16:00: the morning things are over (default length 3 h), the hero becomes a plain line', () => {
    const now = new Date('2026-11-26T16:00:00Z');
    const c = glanceCounts(ALL, now, LON);
    expect(c.today).toBe(4); // Hansel & Gretel, Honey Bees (to 16:30), Sight Loss (to 17:00), Bedtime Bookbug
    const html = glanceHtml(c, opts(now));
    expect(html).toContain('<h2 class="evg__title">4 things on today</h2>');
    expect(html).toContain('1 tonight · 1 free');
  });
  it('after midnight nothing of the 26th counts; the pointer names the next day that has something, never a "nothing" line', () => {
    const now = new Date('2026-11-27T01:00:00Z');
    const c = glanceCounts(ALL, now, LON);
    expect(c.today).toBe(0);
    expect(c.next).toEqual({ day: localDayNumber(new Date('2026-11-28T12:00:00Z'), LON), count: 3 });
    expect(ymdOfDay(c.next!.day)).toBe('2026-11-28');
    const html = glanceHtml(c, opts(now));
    expect(html).toContain('href="#day-2026-11-28"');
    expect(html).toContain('Tomorrow: 3 things');
    // two days out it is the weekday
    expect(glanceHtml(c, { ...opts(now), todayNo: opts(now).todayNo - 1 })).toContain('Sat: 3 things');
    expect(html).not.toMatch(/nothing/i);
  });
  it('nothing today and nothing later: no markup at all (the block stays hidden)', () => {
    expect(glanceHtml(glanceCounts([SOFT_PLAY], new Date('2026-11-27T01:00:00Z'), LON), opts(new Date('2026-11-27T01:00:00Z')))).toBe('');
  });
});

describe('wiring', () => {
  it('EventsGlance prints no count at build: the top is empty and hidden until the browser fills it', () => {
    const src = readFileSync(new URL('../../components/events/EventsGlance.astro', import.meta.url), 'utf8');
    expect(src).toContain('<div class="evg__top" data-evg-top hidden></div>');
    expect(src).not.toMatch(/view\.todayCount\}|thingsOnToday\(/);
    expect(src).toContain("import { applyEventsGlance } from '../../lib/client/events-glance'");
  });
});
