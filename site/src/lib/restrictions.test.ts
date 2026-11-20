import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  restrictionView, postedLine, checkedLine, UNKNOWN_TEXT, NONE_TEXT, STALE_AFTER_MS, MAX_SHOWN, CHECK_FREQUENCY_TEXT,
  type RestrictionCheck, type RestrictionAlert,
} from './restrictions';
import { buildRestrictionStatus } from './cityStatus';
import { SCRAPE_CRON, SCRAPE_WORKFLOWS, TRAFFIC_WORKFLOW } from '../../../cron-dispatcher/src/schedule';

/** lib/restrictions.ts (Fas 5 source 1). Rows are what scrapers/parsers/alert_center_restrictions.py writes for the two real
 *  category pages read 2026-11-19 (tests/test_alert_center_restrictions.py, same fixtures): fire CID=8 "Red Flag Warning"
 *  (November 18, 2026 6:00 PM) and "Level 1 Fire Restrictions in Effect" (November 17, 2026 6:54 PM); water CID=9 "Broomfield is
 *  Under a Drought Watch" (February 9, 2026 8:00 AM). Edge cases change one named field of those rows. */
const FIRE_URL = 'https://broomfield.org/AlertCenter.aspx?CID=Fire-Alerts-and-Restrictions-8';
const WATER_URL = 'https://broomfield.org/AlertCenter.aspx?CID=Water-Restrictions-and-Drought-Condition-9';
const CHECKED = '2026-11-19T23:00:00.000Z';
const NOW = new Date('2026-11-20T02:00:00Z');
const TZ = 'America/Denver';

const RED_FLAG: RestrictionAlert = { title: 'Red Flag Warning', since_at: '2026-11-18T18:00:00-07:00',
  url: 'https://broomfield.org/AlertCenter.aspx?AID=Red-Flag-Warning-88' };
const LEVEL_1: RestrictionAlert = { title: 'Level 1 Fire Restrictions in Effect', since_at: '2026-11-17T18:54:00-07:00',
  url: 'https://broomfield.org/AlertCenter.aspx?AID=Level-1-Fire-Restrictions-in-Effect-90' };
const DROUGHT: RestrictionAlert = { title: 'Broomfield is Under a Drought Watch', since_at: '2026-02-09T08:00:00-07:00',
  url: 'https://broomfield.org/AlertCenter.aspx?AID=Broomfield-is-Under-a-Drought-Watch-92' };

const fire: RestrictionCheck = { kind: 'fire', state: 'active', alerts: [RED_FLAG, LEVEL_1], alert_count: 2, source_url: FIRE_URL, checked_at: CHECKED };
const water: RestrictionCheck = { kind: 'water', state: 'active', alerts: [DROUGHT], alert_count: 1, source_url: WATER_URL, checked_at: CHECKED };
/** The scraper's row for a failed fetch or a changed page: state unknown, no alerts (the changed fields). */
const failed = (row: RestrictionCheck, checked_at: string): RestrictionCheck => ({ ...row, state: 'unknown', alerts: null, alert_count: null, checked_at });
const noneRow = (row: RestrictionCheck): RestrictionCheck => ({ ...row, state: 'none', alerts: [], alert_count: 0 });

describe('restrictionView', () => {
  it('level 1 plus a red flag warning: both titles verbatim, newest first, each with its own posted date', () => {
    const v = restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, NOW);
    expect(v).toMatchObject({ state: 'active', sourceUrl: FIRE_URL, tone: 'notice', more: null,
      text: 'Red Flag Warning; Level 1 Fire Restrictions in Effect' });
    expect(v.alerts.map((a) => [a.title, postedLine(a.sinceAt, TZ), a.url])).toEqual([
      ['Red Flag Warning', 'Posted Nov 18, 2026', RED_FLAG.url],
      ['Level 1 Fire Restrictions in Effect', 'Posted Nov 17, 2026', LEVEL_1.url],
    ]);
    expect(checkedLine(v, TZ)).toBe('Last checked Nov 19, 4:00 PM');
    expect(v.staleAt).toBe(new Date(Date.parse(CHECKED) + STALE_AFTER_MS).toISOString());
  });

  it('newest first even when the row arrives in another order', () => {
    const v = restrictionView('fire', { ...fire, alerts: [LEVEL_1, RED_FLAG] }, fire, { sourceUrl: FIRE_URL }, NOW);
    expect(v.alerts.map((a) => a.title)).toEqual(['Red Flag Warning', 'Level 1 Fire Restrictions in Effect']);
  });

  it(`at most ${MAX_SHOWN} shown, the rest as a count`, () => {
    // the three real alerts plus the real Red Flag row with one changed field (since_at a day later) = 4
    const fourth: RestrictionAlert = { ...RED_FLAG, since_at: '2026-11-19T18:00:00-07:00' };
    const v = restrictionView('fire', { ...fire, alerts: [fourth, RED_FLAG, LEVEL_1, DROUGHT], alert_count: 4 }, fire,
      { sourceUrl: FIRE_URL }, NOW);
    expect(v.alerts).toHaveLength(3);
    expect(v.alerts.at(-1)?.title).toBe('Level 1 Fire Restrictions in Effect');
    expect(v.more).toBe('+1 more alert');
  });

  it('water drought watch', () => {
    const v = restrictionView('water', water, water, { sourceUrl: WATER_URL }, NOW);
    expect(v.text).toBe('Broomfield is Under a Drought Watch');
    expect(postedLine(v.alerts[0].sinceAt, TZ)).toBe('Posted Feb 9, 2026');
  });

  it('no restriction: only from a fresh successful check whose page said 0 (state none)', () => {
    for (const [kind, row] of [['fire', fire], ['water', water]] as const) {
      const v = restrictionView(kind, noneRow(row), noneRow(row), { sourceUrl: row.source_url }, NOW);
      expect(v).toMatchObject({ state: 'none', text: NONE_TEXT[kind], tone: 'quiet', alerts: [] });
      expect(checkedLine(v, TZ)).toBe('Last checked Nov 19, 4:00 PM');
    }
  });

  it('fetch failed on the newest check: unknown, even though an older check succeeded', () => {
    const v = restrictionView('fire', failed(fire, '2026-11-20T01:00:00.000Z'), fire, { sourceUrl: FIRE_URL }, NOW);
    expect(v).toMatchObject({ state: 'unknown', text: UNKNOWN_TEXT, sourceUrl: FIRE_URL, staleAt: null, alerts: [] });
    expect(checkedLine(v, TZ)).toBe('Last successful check Nov 19, 4:00 PM');
  });

  it('a failed check after "none" is unknown, never "no restrictions"', () => {
    const v = restrictionView('water', failed(water, '2026-11-20T01:00:00.000Z'), noneRow(water), { sourceUrl: WATER_URL }, NOW);
    expect(v.text).toBe(UNKNOWN_TEXT);
  });

  it('changed page structure (the scraper wrote unknown): unknown, no crash', () => {
    const v = restrictionView('fire', failed(fire, CHECKED), null, { sourceUrl: FIRE_URL }, NOW);
    expect(v).toMatchObject({ state: 'unknown', text: UNKNOWN_TEXT, checkedAt: null });
    expect(checkedLine(v, TZ)).toBe('Not checked yet');
    // an "active" row without usable titles (should not happen) is unknown too, never an empty line
    expect(restrictionView('fire', { ...fire, alerts: [{ ...RED_FLAG, title: '  ' }] }, fire, { sourceUrl: FIRE_URL }, NOW).state).toBe('unknown');
    expect(restrictionView('fire', { ...fire, alerts: null }, fire, { sourceUrl: FIRE_URL }, NOW).state).toBe('unknown');
  });

  it('old data: more than 48 h after the last check is unknown; exactly 48 h is still shown', () => {
    const at48 = new Date(Date.parse(CHECKED) + STALE_AFTER_MS);
    expect(restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, at48).state).toBe('active');
    const later = new Date(at48.getTime() + 60_000);
    expect(restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, later)).toMatchObject({ state: 'unknown', text: UNKNOWN_TEXT });
  });

  it('no row at all (table empty or DB unreadable): unknown with the configured source link', () => {
    expect(restrictionView('water', null, null, { sourceUrl: WATER_URL }, NOW)).toMatchObject({
      state: 'unknown', text: UNKNOWN_TEXT, sourceUrl: WATER_URL,
    });
  });
});

describe('"We check it ..." matches the real schedule', () => {
  it('Broomfield runs in the 11:00/23:00 UTC scrape only (traffic.yml is --only traffic), so: twice a day', () => {
    const hours = SCRAPE_CRON.split(' ')[1].split(',');
    expect(SCRAPE_WORKFLOWS).toContain('broomfield-scrape.yml');
    expect(TRAFFIC_WORKFLOW).toBe('traffic.yml');
    expect(hours).toHaveLength(2);
    expect(CHECK_FREQUENCY_TEXT).toBe('We check it twice a day.');
  });
});

describe('CityStatus restriction rows', () => {
  it('known row: the titles, links to /safety/, swaps to unknown at the 48 h mark in the browser', () => {
    const m = buildRestrictionStatus(restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, NOW));
    expect(m).toMatchObject({ id: 'fire_restrictions', label: 'Fire alerts and restrictions',
      value: 'Red Flag Warning; Level 1 Fire Restrictions in Effect', tone: 'notice', href: '/safety/#restrictions' });
    expect(m.swapAt).toEqual({ at: new Date(Date.parse(CHECKED) + STALE_AFTER_MS).toISOString(), value: UNKNOWN_TEXT, href: FIRE_URL });
  });

  it('unknown row links straight to the source and has nothing to swap', () => {
    const m = buildRestrictionStatus(restrictionView('water', null, null, { sourceUrl: WATER_URL }, NOW));
    expect(m).toMatchObject({ value: UNKNOWN_TEXT, href: WATER_URL, swapAt: undefined });
  });

  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('Broomfield has the rows and the sources; a town listing them without restrictions config fails the build', async () => {
    vi.stubEnv('SITE_CITY', 'broomfield_co');
    vi.resetModules();
    const bf = (await import('./site-config')).siteConfig;
    const { validateStatusModules } = await import('./cityStatus');
    expect(bf.statusModules).toEqual(expect.arrayContaining(['fire_restrictions', 'water_restrictions']));
    expect(bf.restrictions?.fire?.sourceUrl).toBe(FIRE_URL);
    expect(bf.restrictions?.water?.sourceUrl).toBe(WATER_URL);
    expect(() => validateStatusModules(bf)).not.toThrow();
    expect(() => validateStatusModules({ ...bf, restrictions: undefined })).toThrow(/fire_restrictions/);
  });

  it.each(['brookings_sd', 'moreno_valley_ca', 'glasgow'])('%s has no restrictions config and no rows', async (town) => {
    vi.stubEnv('SITE_CITY', town);
    vi.resetModules();
    const cfg = (await import('./site-config')).siteConfig;
    expect(cfg.restrictions).toBeUndefined();
    expect(cfg.statusModules ?? []).not.toContain('fire_restrictions');
  });
});
