/** The holiday group of the evening layer (owner 2026-11-15). Real rows only: Glasgow's /christmas/ data as committed
 *  (config/holiday-pages/gb/christmas-glasgow.ts), its window from config/holiday-pages/calendar.ts. */
import { describe, expect, it } from 'vitest';
import { openHolidayPages, seasonEveningEntries, hoursOn, type SeasonSource } from './evening-season';
import { eveningEntries, groupEntries } from './evening-page';
import { buildWeekendSections } from './evening-weekend';
import { eveningNights } from './evening-threshold';
import { toThresholdItems } from './evening-items';
import { localDayNumber } from './local-day';

const tz = 'Europe/London';
const sourcesAt = (now: Date): SeasonSource[] =>
  openHolidayPages('glasgow', now.getTime(), tz).map((e) => ({ label: e.def.label, href: `/${e.def.slug}/`, page: e.page }));
const tonight = (now: Date) => {
  const entries = seasonEveningEntries(sourcesAt(now), [], { now, timezone: tz });
  return { entries, evening: eveningEntries(entries, localDayNumber(now, tz), tz) };
};

describe('holiday group on /tonight', () => {
  it('Fri 20 Nov: both Winter Wonderlands are open in the evening -> a Christmas group linking to /christmas/, with that day\'s hours', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const { entries, evening } = tonight(now);
    const groups = groupEntries(evening);
    expect(groups.map((g) => [g.name, g.href])).toEqual([['Christmas', '/christmas/']]);
    expect(groups[0].entries.map((e) => [e.title, e.hours, e.href])).toEqual([
      ["Glasgow's Winter Wonderland, St Enoch Square", '12 noon–10pm', 'https://www.glasgowswinterwonderland.com/st-enoch/'],
      ["Glasgow's Winter Wonderland, Glasgow Green", '3pm–10pm', 'https://www.glasgowswinterwonderland.com/glasgow-green/'],
    ]);
    // the group counts toward the threshold like any other
    expect(eveningNights(toThresholdItems(entries), now, tz)[0]).toMatchObject({ items: 2, groups: 1 });
  });

  it('Fri 25 Dec: both are closed -> no group at all', () => {
    const now = new Date('2026-12-25T12:00:00Z');
    const { entries, evening } = tonight(now);
    for (const e of sourcesAt(now)[0].page.events) if (e.status === 'confirmed' && e.openHours) expect(hoursOn(e.openHours, '2026-12-25')).toBeNull();
    expect(evening).toEqual([]);
    expect(groupEntries(evening)).toEqual([]);
    expect(eveningNights(toThresholdItems(entries), now, tz)[0]).toMatchObject({ items: 0, groups: 0 });
  });

  it('Tue 5 Jan 2027: the window has closed (last bank holiday Mon 4 Jan) -> no holiday page, no group', () => {
    expect(openHolidayPages('glasgow', new Date('2027-01-04T12:00:00Z').getTime(), tz)).toHaveLength(1);
    const now = new Date('2027-01-05T18:00:00Z');
    expect(openHolidayPages('glasgow', now.getTime(), tz)).toEqual([]);
    expect(groupEntries(tonight(now).evening)).toEqual([]);
  });

  it('a daytime row is not on /tonight but is on Saturday of /this-weekend (Meet the Grinch, Sat 28 Nov 12:30)', () => {
    const now = new Date('2026-11-28T09:00:00Z');
    const { entries, evening } = tonight(now);
    expect(evening.map((e) => e.title)).not.toContain('Meet the Grinch at Riverside Christmas Market');
    const saturday = buildWeekendSections(entries, now, tz)[1];
    const christmas = saturday.groups.find((g) => g.name === 'Christmas')!;
    expect(christmas.href).toBe('/christmas/');
    expect(christmas.entries.map((e) => e.title)).toContain('Meet the Grinch at Riverside Christmas Market');
  });

  it('a row already listed in another group stays there (Muppet Christmas Carol, Wed 2 Dec 19:00, here as a Live music row)', () => {
    const now = new Date('2026-12-02T12:00:00Z');
    const own = tonight(now).evening.find((e) => e.title === "Disney's The Muppet Christmas Carol in Concert")!;
    expect(own.season?.label).toBe('Christmas');
    // the same row with only source, group and season changed: what the evening layer itself lists under Live music
    const listed = { ...own, id: 'tm:muppet', source: 'ticketmaster' as const, group: 'Live music' as const, season: undefined };
    const again = seasonEveningEntries(sourcesAt(now), [listed], { now, timezone: tz });
    expect(eveningEntries(again, localDayNumber(now, tz), tz).map((e) => e.title)).not.toContain(own.title);
  });
});
