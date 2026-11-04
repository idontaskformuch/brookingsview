import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHolidayMeta, buildHolidayEventsJsonLd, isBlockedHost, formatIsoDate, type HolidayPageData } from './holiday-page';
import {
  VETERANS_DAY, VETERANS_DAY_WINDOW_START, VETERANS_DAY_WINDOW_END, isOutsideVeteransDayWindow,
} from './veterans-day';
import { buildVeteransDayPage, VETERANS_DAY_META, VETERANS_DAY_TOWN_IDS } from '../config/holiday-pages/veterans-day';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = buildVeteransDayPage('broomfield_co') as HolidayPageData;

describe('Veterans Day page data', () => {
  it('exists for Broomfield only', () => {
    expect([...VETERANS_DAY_TOWN_IDS]).toEqual(['broomfield_co']);
    for (const id of ['brookings_sd', 'moreno_valley_ca', 'glasgow']) expect(buildVeteransDayPage(id)).toBeNull();
    expect(page.year).toBe(2026);
    expect(page.locale).toBe('en-US');
  });

  it('every fact has a source URL and a check date; an unconfirmed one says where to check or what last year was', () => {
    for (const f of page.facts) {
      expect(f.source.url).toMatch(/^https:\/\//);
      expect(f.checkedOn).toMatch(ISO);
      if (f.status === 'unconfirmed') expect(f.checkAt ?? f.lastYear).toBeTruthy();
      if (f.status === 'confirmed') expect(f.value.length).toBeGreaterThan(0);
      expect(isBlockedHost(f.source.url)).toBe(false);
      expect(f.section).not.toBe('events');
    }
  });

  it('standing hours stay out of the closures section, and nothing implies normal operation', () => {
    expect(page.facts.some((f) => f.section === 'hours')).toBe(false);
    const closures = page.facts.filter((f) => f.section === 'closures');
    for (const f of closures) expect(JSON.stringify(f)).not.toMatch(/regular|normal|open as usual/i);
  });

  it('the police row keeps the unstaffed front desk (a "24/7" alone would mislead)', () => {
    const police = page.facts.find((f) => f.label.startsWith('Police'));
    expect(police?.status).toBe('confirmed');
    expect((police as { value: string }).value).toMatch(/front desk is not staffed/);
  });

  it('FISH is an unconfirmed fact with only the Wednesday time, linked to broomfieldfish.org', () => {
    const fish = page.facts.find((f) => f.label === 'Broomfield FISH food bank');
    expect(fish?.status).toBe('unconfirmed');
    if (fish?.status !== 'unconfirmed') throw new Error('unreachable');
    expect(fish.clarify).toBe('FISH has not announced a change for Nov 11.');
    expect(fish.usual).toBe('Wednesday 1–6 p.m.');
    expect(fish.source.url).toBe('https://www.broomfieldfish.org/');
    expect(fish.checkAt?.url).toBe('https://www.broomfieldfish.org/');
  });

  it('rec centers, trash and RTD are unconfirmed with a checkAt', () => {
    for (const label of ['Recreation centers', 'Holiday collection (Waste Connections)', 'RTD service on Nov 11']) {
      const f = page.facts.find((x) => x.label === label);
      expect(f?.status, label).toBe('unconfirmed');
      expect((f as { checkAt?: unknown }).checkAt, label).toBeTruthy();
    }
  });

  it('the one event is the organizer\'s own announcement, with date, time and place, and gets JSON-LD', () => {
    expect(page.events).toHaveLength(1);
    const e = page.events[0];
    expect(e.status).toBe('confirmed');
    if (e.status !== 'confirmed') throw new Error('unreachable');
    expect(e.source.url).toContain('broomfieldveterans.org');
    expect(e.date).toBe('2026-11-11');
    expect(e.startTime).toBe('11:00');
    expect(e.venue.street).toBe('12 Garden Center');
    const ld = buildHolidayEventsJsonLd(page, 'America/Denver');
    expect(ld).toHaveLength(1);
    expect(ld[0].startDate).toBe('2026-11-11T11:00:00-07:00');
  });

  it('shows the last check date from the data', () => {
    expect(formatIsoDate('2026-11-04', true)).toBe('November 4, 2026');
  });
});

describe('Veterans Day meta (owner wording 2026-11-04)', () => {
  const meta = buildHolidayMeta(page, 'Veterans Day', 'Broomfield');
  it('title and H1 promise only what the page has', () => {
    expect(meta.title).toBe("Veterans Day 2026 in Broomfield: what's closed on Nov 11");
    expect(meta.h1).toBe("Veterans Day 2026: what's closed on Nov 11");
    expect(meta.title + meta.h1).not.toMatch(/trash|events/i);
  });
  it('description is at most 160 characters and keeps the police detail', () => {
    expect(meta).toEqual(VETERANS_DAY_META);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(meta.description).toContain('Police run 24/7 but the front desk is unstaffed.');
    expect(meta.description).toContain('Trash, RTD and rec hours unconfirmed.');
  });
});

describe('window and sitemap gating', () => {
  it('is indexable Nov 1 through Nov 12 2026, noindex outside', () => {
    expect(isOutsideVeteransDayWindow(Date.UTC(2026, 9, 31, 23, 59))).toBe(true);
    expect(isOutsideVeteransDayWindow(Date.UTC(2026, 10, 1))).toBe(false);
    expect(isOutsideVeteransDayWindow(Date.UTC(2026, 10, 4, 12))).toBe(false); // today when ordered
    expect(isOutsideVeteransDayWindow(Date.UTC(2026, 10, 12, 23, 59))).toBe(false);
    expect(isOutsideVeteransDayWindow(Date.UTC(2026, 10, 13))).toBe(true);
    expect(VETERANS_DAY).toBe(Date.UTC(2026, 10, 11));
  });

  const cfg = read('../../astro.config.mjs');
  it('/veterans-day/ is in the sitemap for Broomfield only', () => {
    const m = /\{ path: '\/veterans-day\/', activeFor: \[([^\]]*)\] \}/.exec(cfg);
    expect(m).not.toBeNull();
    expect(m![1].replace(/\s/g, '')).toBe("'broomfield_co'");
  });
  it('astro.config mirrors the window so the sitemap and the noindex tag never disagree', () => {
    expect(cfg).toContain(`Date.parse('${new Date(VETERANS_DAY_WINDOW_START).toISOString().slice(0, 10)}T00:00:00Z')`);
    expect(cfg).toContain(`Date.parse('${new Date(VETERANS_DAY_WINDOW_END).toISOString().slice(0, 10)}T00:00:00Z')`);
    expect(cfg).toMatch(/noindexThinPageUrls\.add\('\/veterans-day\/'\)/);
  });
});
