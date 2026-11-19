// Fas 1 (spec .claude/specs/full-pages-no-ai-prose.md, owner decisions 2026-11-18): the town's face. QA: qa/checks.json
// front.city-photo-rotation, front.alert-lead-no-photo, holiday.band-photo, build.no-dead-image-urls.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import {
  pickWeekImage, reservedHolidayImage, reserveFrom, holidayBandImage, cityImageSlot, responsiveSrc, weeksInWindow, reservedIdsForWeek,
  type CityImage,
} from './city-face';
import { thisWeekImagesFor } from '../config/this-week-images';
import { townHolidays, holidayImagesFor } from '../config/holidays';
import { holidayWindow, type DateYMD } from './holidays';
import { weekInfoForInstant, addDays } from './this-week';
import type { ThisWeekUsageRecord } from './this-week-images';
import { ALL_CONFIGS } from './site-config';
import { selectFrontPage } from './front-page';
import { frontPageAlerts } from './front-page-alerts';
import { frontPageHolidays } from './front-page-holidays';
import { FRONT_PAGE_BY_TOWN } from '../config/front-page';
import FrontPageLead from '../components/FrontPageLead.astro';

const TOWNS = ['broomfield_co', 'brookings_sd', 'moreno_valley_ca', 'glasgow'] as const;
const DAY = 86_400_000;
const ymd = (ms: number): DateYMD => { const d = new Date(ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const dayNum = (d: DateYMD) => Date.UTC(d.y, d.m - 1, d.d) / DAY;
const tzOf = (t: string) => ALL_CONFIGS.find((c) => c.townId === t)!.timezone;

/** One front-page photo per week, recorded as the production build does, from 7 Sep 2026 (w37, the first week whose Monday is in autumn) to 28 Feb 2027 (the seasons the pools cover:
 *  autumn and winter; spring/summer pools do not exist yet, see the report). Every day maps to its week's photo. */
function simulate(town: string) {
  const pool = thisWeekImagesFor(town);
  const history: ThisWeekUsageRecord[] = [];
  const byWeek = new Map<string, { image: CityImage; holiday: string | null; monday: DateYMD; sunday: DateYMD }>();
  const days: { day: DateYMD; week: string }[] = [];
  for (let ms = Date.UTC(2026, 8, 7); ms <= Date.UTC(2027, 1, 28); ms += DAY) {
    const week = weekInfoForInstant(new Date(ms + 12 * 3600_000), tzOf(town));
    days.push({ day: ymd(ms), week: week.slug });
    if (byWeek.has(week.slug)) continue;
    const shownAt = new Date(Date.UTC(week.monday.y, week.monday.m - 1, week.monday.d, 12));
    const pick = pickWeekImage({ town, isoYearWeek: week.slug, monday: week.monday, sunday: week.sunday, seasonPool: pool, history, now: shownAt });
    expect(pick.image, `${town} ${week.slug}`).not.toBeNull();
    history.push({ imageId: pick.image!.id, shownAt });
    byWeek.set(week.slug, { image: pick.image!, holiday: pick.holiday?.holiday ?? null, monday: week.monday, sunday: week.sunday });
  }
  return { byWeek, days, history };
}

describe('front-page photo rotation, every day 7 Sep 2026 - 28 Feb 2027', () => {
  for (const town of TOWNS) {
    it(`${town}: one photo with alt and credit every day, no repeat within 60 days, holiday photos only in their window`, () => {
      const { byWeek, days, history } = simulate(town);
      for (const { day, week } of days) {
        const w = byWeek.get(week)!;
        expect(w.image.alt.trim(), `${town} ${day.y}-${day.m}-${day.d}`).not.toBe('');
        expect((w.image.attributionText ?? '').trim(), `${town} ${week}`).not.toBe('');
      }
      for (let i = 0; i < history.length; i++) {
        for (let j = i + 1; j < history.length; j++) {
          if (history[j].shownAt.getTime() - history[i].shownAt.getTime() >= 60 * DAY) break;
          expect(history[j].imageId, `${town}: ${history[i].imageId} again within 60 days`).not.toBe(history[i].imageId);
        }
      }
      for (const [slug, w] of byWeek) {
        if (!('holiday' in w.image)) continue;
        const img = w.image as { holiday: string };
        const def = townHolidays(town).find((h) => h.id === img.holiday)!;
        const overlaps = [w.monday.y - 1, w.monday.y, w.monday.y + 1].some((y) => {
          const win = holidayWindow(def, y);
          return dayNum(w.monday) <= dayNum(win.end) && dayNum(win.start) <= dayNum(w.sunday);
        });
        expect(overlaps, `${town} ${slug}: ${w.image.id} outside its window`).toBe(true);
        // The page's reserved photo is never the front page's.
        expect(reservedIdsForWeek(town, w.monday, w.sunday).has(w.image.id), `${town} ${slug}`).toBe(false);
      }
    });
  }
});

describe('the holiday page reservation (owner 2026-11-18: pool < weeks in window + 1 -> no reservation)', () => {
  it('Christmas 11-25 Dec and Thanksgiving 19-26 Nov 2026 overlap 3 and 2 ISO weeks', () => {
    expect(weeksInWindow(townHolidays('brookings_sd').find((h) => h.id === 'christmas')!, 2026)).toBe(3);
    expect(weeksInWindow(townHolidays('brookings_sd').find((h) => h.id === 'thanksgiving')!, 2026)).toBe(2);
  });
  it('is deterministic and comes from the holiday pool (no DB)', () => {
    for (const town of TOWNS) {
      for (const h of townHolidays(town).filter((d) => d.active)) {
        const a = reservedHolidayImage(town, h.id, 2026);
        expect(a?.id).toBe(reservedHolidayImage(town, h.id, 2026)?.id);
        if (a) expect(holidayImagesFor(town, h.id).map((i) => i.id)).toContain(a.id);
      }
    }
  });
  it('Brookings Christmas (4 photos, 3 weeks) reserves exactly one; 3 photos would reserve none', () => {
    const pool = holidayImagesFor('brookings_sd', 'christmas');
    expect(pool).toHaveLength(4);
    expect(reserveFrom(pool, 3, 'x')).not.toBeNull();
    expect(reserveFrom(pool.slice(0, 3), 3, 'x')).toBeNull();
  });
  it('2026 reservations do not collide with the w47 photos already recorded (thanksgiving-06/-03/-03, read 2026-11-18)', () => {
    expect(reservedHolidayImage('brookings_sd', 'thanksgiving', 2026)?.id).not.toBe('brookings_sd-thanksgiving-06');
    expect(reservedHolidayImage('broomfield_co', 'thanksgiving', 2026)?.id).not.toBe('broomfield_co-thanksgiving-03');
    expect(reservedHolidayImage('moreno_valley_ca', 'thanksgiving', 2026)?.id).not.toBe('moreno_valley_ca-thanksgiving-03');
  });
});

describe('holiday page band photo', () => {
  const nov24: DateYMD = { y: 2026, m: 11, d: 24 };
  it('inside the window: the reserved photo, the same all window long', () => {
    const r = reservedHolidayImage('broomfield_co', 'thanksgiving', 2026)!;
    for (let d = 19; d <= 26; d++) expect(holidayBandImage('broomfield_co', 'thanksgiving', { y: 2026, m: 11, d }, '2026-w48', null)?.id).toBe(r.id);
  });
  it('outside the window: still the holiday\'s own photo (owner 2026-11-18); a holiday with no pool (Veterans Day): a season photo', () => {
    const front = thisWeekImagesFor('broomfield_co').find((i) => i.seasons.includes('autumn'))!;
    const tg = holidayBandImage('broomfield_co', 'thanksgiving', { y: 2026, m: 11, d: 10 }, '2026-w46', front.id)!;
    expect('holiday' in tg && tg.holiday).toBe('thanksgiving');
    expect(tg.id).toBe(reservedHolidayImage('broomfield_co', 'thanksgiving', 2026)!.id);
    const vd = holidayBandImage('broomfield_co', 'veterans_day', { y: 2026, m: 11, d: 10 }, '2026-w46', front.id)!;
    expect('seasons' in vd && vd.seasons.includes('autumn')).toBe(true);
    expect(vd.id).not.toBe(front.id);
  });
  it('a reserved photo that equals the week\'s front-page photo gives way to another photo of the same holiday pool', () => {
    const r = reservedHolidayImage('broomfield_co', 'thanksgiving', 2026)!;
    const b = holidayBandImage('broomfield_co', 'thanksgiving', nov24, '2026-w48', r.id)!;
    expect(b.id).not.toBe(r.id);
    expect('holiday' in b && b.holiday).toBe('thanksgiving');
  });
  it('/christmas/ on Nov 18 2026 shows a Christmas photo in all four towns (owner 2026-11-18)', () => {
    const nov18: DateYMD = { y: 2026, m: 11, d: 18 };
    for (const town of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co', 'glasgow']) {
      const front = thisWeekImagesFor(town).find((i) => i.seasons.includes('autumn'))?.id ?? null;
      const b = holidayBandImage(town, 'christmas', nov18, '2026-w47', front)!;
      expect(b, town).not.toBeNull();
      expect('holiday' in b && b.holiday, town).toBe('christmas');
    }
  });
  it('both page templates render the band (HolidaySeasonPage carries Glasgow\'s /christmas/)', () => {
    for (const f of ['HolidayPage.astro', 'HolidaySeasonPage.astro']) {
      const src = readFileSync(join(__dirname, '..', 'components', f), 'utf8');
      expect(src, f).toContain('holidayBandImage(siteConfig.townId, def.holidayId');
      expect(src, f).toContain('<CityPhoto image={band} variant="band" priority>');
    }
  });
  it('after the window the band takes next year\'s Christmas photo, never a season photo', () => {
    const b = holidayBandImage('brookings_sd', 'christmas', { y: 2027, m: 2, d: 1 }, '2027-w05', null)!;
    expect('holiday' in b && b.holiday).toBe('christmas');
  });
});

describe('where the photo goes (owner 2026-11-18)', () => {
  const page = (lead: string, ...sec: string[]) => ({ lead: { type: lead }, secondaries: sec.map((type) => ({ type })) });
  it('the lead, unless the lead is an alert', () => {
    for (const t of ['holiday', 'weekend', 'game_day', 'meeting', 'tonight', 'guide']) expect(cityImageSlot(page(t, 'guide'))).toBe('lead');
  });
  it('alert lead: the first secondary when it is a holiday or the weekend, else nowhere', () => {
    expect(cityImageSlot(page('alert', 'holiday', 'guide'))).toBe('secondary');
    expect(cityImageSlot(page('alert', 'weekend'))).toBe('secondary');
    expect(cityImageSlot(page('alert', 'meeting', 'holiday'))).toBeNull();
    expect(cityImageSlot(page('alert'))).toBeNull();
  });
});

describe('alert lead + Thanksgiving window: no photo in the lead, the photo on the holiday secondary', () => {
  // Real row: events.id 333038 (broomfield_co, nws_alert, "Red Flag Warning", 2026-11-18 15:00-23:00 UTC). The ONLY changed field is
  // ends_at (2026-11-18T23:00Z -> 2026-11-24T23:00Z), so the warning is in effect on FRONT_PAGE_NOW, inside the Thanksgiving window.
  const FRONT_PAGE_NOW = '2026-11-24T18:00:00Z';
  const alertRow = { ends_at: '2026-11-24T23:00:00Z', alert: { title: 'Red Flag Warning', source: 'nws_alert' } };

  it('selects the alert as lead and Thanksgiving as the first secondary, and renders the photo only there', async () => {
    const now = new Date(FRONT_PAGE_NOW);
    const town = 'broomfield_co';
    const fp = selectFrontPage({
      cityName: 'Broomfield', timezone: tzOf(town), locale: 'en-US', config: FRONT_PAGE_BY_TOWN[town],
      alerts: frontPageAlerts([alertRow] as never), holidays: frontPageHolidays(town, 2026), evening: [], games: [], meetings: [],
    }, now);
    expect(fp.lead.type).toBe('alert');
    expect(fp.lead.headline).toBe('Red Flag Warning');
    expect(fp.secondaries[0].type).toBe('holiday');
    expect(fp.secondaries[0].kicker).toBe('Thanksgiving · in 2 days');
    expect(cityImageSlot(fp)).toBe('secondary');

    const week = weekInfoForInstant(now, tzOf(town));
    const city = pickWeekImage({ town, isoYearWeek: week.slug, monday: week.monday, sunday: week.sunday, seasonPool: thisWeekImagesFor(town), history: [], now }).image!;
    expect(city.id).toMatch(/^broomfield_co-thanksgiving-/);
    const html = await (await AstroContainer.create()).renderToString(FrontPageLead, { props: { page: fp, cityImage: city, thumbs: fp.secondaries.map((_, i) => (i === 0 && cityImageSlot(fp) === 'secondary' ? city : null)) } });
    const lead = html.slice(html.indexOf('<article class="lead'), html.indexOf('</article>') + 10);
    expect(lead).not.toContain('<img');
    const second = html.slice(html.indexOf('data-type="holiday"'));
    expect(second).toContain(responsiveSrc(city.path).src);
    expect((html.match(/<img/g) ?? []).length).toBe(1);
  });

  it('without the alert the same day, the photo is the lead\'s, with the kicker and headline on it', async () => {
    const now = new Date(FRONT_PAGE_NOW);
    const town = 'broomfield_co';
    const fp = selectFrontPage({
      cityName: 'Broomfield', timezone: tzOf(town), locale: 'en-US', config: FRONT_PAGE_BY_TOWN[town],
      alerts: [], holidays: frontPageHolidays(town, 2026), evening: [], games: [], meetings: [],
    }, now);
    expect(fp.lead.type).toBe('holiday');
    const city = thisWeekImagesFor(town)[0];
    const html = await (await AstroContainer.create()).renderToString(FrontPageLead, { props: { page: fp, cityImage: city, thumbs: fp.secondaries.map(() => null) } });
    const lead = html.slice(html.indexOf('<article class="lead'), html.indexOf('</article>') + 10);
    expect(lead).toMatch(/<img[^>]+fetchpriority="high"/);
    expect(lead).toMatch(/city-photo__scrim[\s\S]*Thanksgiving · in 2 days[\s\S]*<h2/);
    expect(lead).toContain(city.attributionText!);
  });
});

describe('scrim contrast (AA, measured against the flat part of the scrim over a white photo)', () => {
  const css = readFileSync(join(__dirname, '..', 'components', 'CityPhoto.astro'), 'utf8');
  const alpha = Number(/rgb\(0 0 0 \/ ([\d.]+)\) 0,/.exec(css)![1]);
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const worst = Math.round(255 * (1 - alpha));
  const bg = `#${worst.toString(16).padStart(2, '0').repeat(3)}`;
  const ratio = (fg: string) => (lum(fg) + 0.05) / (lum(bg) + 0.05);
  it('white headline text >= 4.5', () => { expect(ratio('#ffffff')).toBeGreaterThanOrEqual(4.5); });
  it('every town\'s kicker colour (--brand-accent-on-dark = accentInkDark) >= 4.5', () => {
    for (const c of ALL_CONFIGS) {
      if (!c.brand) continue;
      expect(ratio(c.brand.accentInkDark), c.townId).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('responsive WebP variants', () => {
  it('pool JPGs get a 640/960/1200 srcset; anything else is unchanged', () => {
    expect(responsiveSrc('/assets/images/this-week/broomfield_co-autumn-04.jpg')).toEqual({
      src: '/assets/images/this-week/broomfield_co-autumn-04-960.webp',
      srcset: '/assets/images/this-week/broomfield_co-autumn-04-640.webp 640w, /assets/images/this-week/broomfield_co-autumn-04-960.webp 960w, /assets/images/this-week/broomfield_co-autumn-04-1200.webp 1200w',
    });
    expect(responsiveSrc('/img/ticketmaster?u=x')).toEqual({ src: '/img/ticketmaster?u=x' });
    expect(responsiveSrc('/assets/images/categories/broomfield_co-events-1.png')).toEqual({ src: '/assets/images/categories/broomfield_co-events-1.png' });
  });
  it('addDays sanity for the simulation helper', () => { expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 }); });
});
