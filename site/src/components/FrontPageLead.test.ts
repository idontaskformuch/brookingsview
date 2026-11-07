import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import FrontPageLead from './FrontPageLead.astro';
import { selectFrontPage } from '../lib/front-page';
import { frontPageHolidays } from '../lib/front-page-holidays';
import { FRONT_PAGE_BY_TOWN } from '../config/front-page';

const TOWNS = [
  { id: 'broomfield_co', city: 'Broomfield', tz: 'America/Denver', locale: 'en-US' as const },
  { id: 'brookings_sd', city: 'Brookings', tz: 'America/Chicago', locale: 'en-US' as const },
  { id: 'moreno_valley_ca', city: 'Moreno Valley', tz: 'America/Los_Angeles', locale: 'en-US' as const },
  { id: 'glasgow', city: 'Glasgow', tz: 'Europe/London', locale: 'en-GB' as const },
];
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('FrontPageLead markup, every town, every day of 2026', () => {
  for (const t of TOWNS) {
    it(`${t.city}: one lead, one article per secondary, a guide lead has exactly 1 secondary, no empty slot`, async () => {
      const c = await AstroContainer.create();
      let guideLeadDays = 0;
      for (let d = 0; d < 366; d++) {
        const now = new Date(Date.UTC(2026, 0, 1, 12) + d * 86_400_000);
        const page = selectFrontPage({
          cityName: t.city, timezone: t.tz, locale: t.locale, config: FRONT_PAGE_BY_TOWN[t.id],
          alerts: [], holidays: frontPageHolidays(t.id, 2026), evening: [], games: [], meetings: [],
        }, now);
        const html = await c.renderToString(FrontPageLead, { props: { page } });
        const where = `${t.id} ${now.toISOString()}`;
        expect(count(html, /<article class="lead[ "]/g), where).toBe(1);
        const sec = count(html, /<article class="secondary[ "]/g);
        expect(sec, where).toBe(page.secondaries.length);
        expect(sec, where).toBeGreaterThanOrEqual(1);
        expect(sec, where).toBeLessThanOrEqual(3);
        expect(html, where).toContain(`front__secondary--${sec}`);
        expect(html, where).toContain(`data-count="${sec}"`);
        // every slot has a linked headline and a deck: nothing empty
        expect(count(html, /<h3 class="secondary__title[^"]*"[^>]*><a href="\/[^"]+"[^>]*>[^<]+<\/a><\/h3>/g), where).toBe(sec);
        expect(count(html, /<p class="secondary__deck[^"]*"[^>]*>[^<]+<\/p>/g), where).toBe(sec);
        expect(count(html, /<h2 class="lead__title[^"]*"[^>]*><a href="\/[^"]+"[^>]*>[^<]+<\/a><\/h2>/g), where).toBe(1);
        if (page.lead.type === 'guide') { guideLeadDays++; expect(sec, where).toBe(1); }
      }
      expect(guideLeadDays).toBeGreaterThan(0);
    });
  }
});
