import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner 2026-11-24: an empty /events/ (Moreno Valley with its Tockify sources paused) shows no "no events" message. The day sections are absent,
// Nearby / Recently / related sections carry the page, and the town's calendars are plain links.
const page = readFileSync(new URL('../pages/events.astro', import.meta.url), 'utf8');

describe('/events/ when nothing is listed', () => {
  it('prints no empty-state message', () => {
    expect(page).not.toContain('CalendarEmpty');
    expect(page).not.toMatch(/No events in/);
  });
  it('offers the city and library calendars as plain links, and only when the list is empty', () => {
    expect(page).toContain('eventsEmpty && calendarLinks.length > 0');
    expect(page).toContain('<nav class="ev-calendars" aria-label="Event calendars">');
    expect(page).toContain('siteConfig.eventCalendars?.city, siteConfig.eventCalendars?.library');
  });
});
