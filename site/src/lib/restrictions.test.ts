import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  restrictionView, metaLine, UNKNOWN_TEXT, NONE_TEXT, STALE_AFTER_MS, type RestrictionCheck,
} from './restrictions';
import { buildRestrictionStatus } from './cityStatus';

/** lib/restrictions.ts (Fas 5 source 1). Rows are what scrapers/parsers/alert_center_restrictions.py writes for the two real
 *  pages read 2026-11-19 (tests/test_alert_center_restrictions.py, same fixtures): fire AID=90 "Level 1 Fire Restrictions in
 *  Effect" dated November 17, 2026 6:54 PM; water CID=9 "Broomfield is Under a Drought Watch" dated February 9, 2026 8:00 AM.
 *  Edge cases change one named field of those rows. */
const FIRE_URL = 'https://broomfield.org/AlertCenter.aspx?AID=90';
const WATER_URL = 'https://broomfield.org/AlertCenter.aspx?CID=Water-Restrictions-and-Drought-Condition-9';
const CHECKED = '2026-11-19T23:00:00.000Z';
const NOW = new Date('2026-11-20T02:00:00Z');
const TZ = 'America/Denver';

const fire: RestrictionCheck = {
  kind: 'fire', state: 'active', title: 'Level 1 Fire Restrictions in Effect', since_at: '2026-11-18T01:54:00.000Z',
  alert_count: 1, alert_url: null, source_url: FIRE_URL, checked_at: CHECKED,
};
const water: RestrictionCheck = {
  kind: 'water', state: 'active', title: 'Broomfield is Under a Drought Watch', since_at: '2026-02-09T15:00:00.000Z',
  alert_count: 1, alert_url: 'https://broomfield.org/AlertCenter.aspx?AID=Broomfield-is-Under-a-Drought-Watch-92',
  source_url: WATER_URL, checked_at: CHECKED,
};
/** The scraper's row for a failed fetch or a changed page: state unknown, no title (the changed fields). */
const failed = (row: RestrictionCheck, checked_at: string): RestrictionCheck =>
  ({ ...row, state: 'unknown', title: null, since_at: null, alert_count: null, checked_at });

describe('restrictionView', () => {
  it('level 1: the source title verbatim, since date, last checked, source link', () => {
    const v = restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, NOW);
    expect(v).toMatchObject({ state: 'active', text: 'Level 1 Fire Restrictions in Effect', sourceUrl: FIRE_URL, tone: 'notice', more: null });
    expect(metaLine(v, TZ)).toBe('In effect since Nov 17, 2026 · Last checked Nov 19, 4:00 PM');
    expect(v.staleAt).toBe(new Date(Date.parse(CHECKED) + STALE_AFTER_MS).toISOString());
  });

  it('water drought watch', () => {
    const v = restrictionView('water', water, water, { sourceUrl: WATER_URL }, NOW);
    expect(v.text).toBe('Broomfield is Under a Drought Watch');
    expect(metaLine(v, TZ)).toBe('In effect since Feb 9, 2026 · Last checked Nov 19, 4:00 PM');
  });

  it('no restriction: only from a fresh successful check whose page said 0 (state none)', () => {
    const none: RestrictionCheck = { ...water, state: 'none', title: null, since_at: null, alert_count: 0, alert_url: null };
    const v = restrictionView('water', none, none, { sourceUrl: WATER_URL }, NOW);
    expect(v).toMatchObject({ state: 'none', text: NONE_TEXT.water, tone: 'quiet' });
    expect(metaLine(v, TZ)).toBe('Last checked Nov 19, 4:00 PM');
  });

  it('fetch failed on the newest check: unknown, even though an older check succeeded', () => {
    const latest = failed(fire, '2026-11-20T01:00:00.000Z');
    const v = restrictionView('fire', latest, fire, { sourceUrl: FIRE_URL }, NOW);
    expect(v).toMatchObject({ state: 'unknown', text: UNKNOWN_TEXT, sourceUrl: FIRE_URL, staleAt: null });
    expect(metaLine(v, TZ)).toBe('Last successful check Nov 19, 4:00 PM');
  });

  it('a failed check after "none" is unknown, never "no restrictions"', () => {
    const none: RestrictionCheck = { ...water, state: 'none', title: null, since_at: null, alert_count: 0 };
    const v = restrictionView('water', failed(water, '2026-11-20T01:00:00.000Z'), none, { sourceUrl: WATER_URL }, NOW);
    expect(v.text).toBe(UNKNOWN_TEXT);
    expect(v.text).not.toBe(NONE_TEXT.water);
  });

  it('changed page structure (the scraper wrote unknown): unknown, no crash', () => {
    expect(restrictionView('fire', failed(fire, CHECKED), null, { sourceUrl: FIRE_URL }, NOW)).toMatchObject({
      state: 'unknown', text: UNKNOWN_TEXT, checkedAt: null,
    });
    expect(metaLine(restrictionView('fire', failed(fire, CHECKED), null, { sourceUrl: FIRE_URL }, NOW), TZ)).toBe('Not checked yet');
    // an "active" row without a title (should not happen) is unknown too, never an empty line
    expect(restrictionView('fire', { ...fire, title: '  ' }, fire, { sourceUrl: FIRE_URL }, NOW).state).toBe('unknown');
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

  it('more than one alert in the category: the first title plus a count template', () => {
    expect(restrictionView('water', { ...water, alert_count: 2 }, water, { sourceUrl: WATER_URL }, NOW).more).toBe('+1 more alert');
  });
});

describe('CityStatus restriction rows', () => {
  it('known row links to /safety/ and swaps to unknown at the 48 h mark in the browser', () => {
    const m = buildRestrictionStatus(restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, NOW));
    expect(m).toMatchObject({ id: 'fire_restrictions', label: 'Fire restrictions', value: 'Level 1 Fire Restrictions in Effect',
      tone: 'notice', href: '/safety/#restrictions' });
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
