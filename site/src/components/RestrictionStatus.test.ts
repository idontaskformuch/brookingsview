import { afterEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { restrictionView, type RestrictionCheck, type RestrictionView } from '../lib/restrictions';

/** Tillägg C (owner 2026-11-20): an unknown restriction status is not rendered at all, and the HTML is checked for it. Renders the
 *  real RestrictionStatus.astro for Broomfield with lib/restrictions-data.ts replaced by fixed views. The rows are the real fire
 *  check of 2026-11-19 23:00 UTC (lib/restrictions.test.ts, same alerts); the unknown cases change one named field. */
const FIRE_URL = 'https://broomfield.org/AlertCenter.aspx?CID=Fire-Alerts-and-Restrictions-8';
const WATER_URL = 'https://broomfield.org/AlertCenter.aspx?CID=Water-Restrictions-and-Drought-Condition-9';
const CHECKED = '2026-11-19T23:00:00.000Z';
const NOW = new Date('2026-11-20T02:00:00Z');
const fire: RestrictionCheck = { kind: 'fire', state: 'active', alert_count: 1, source_url: FIRE_URL, checked_at: CHECKED,
  alerts: [{ title: 'Red Flag Warning', since_at: '2026-11-18T18:00:00-07:00', url: 'https://broomfield.org/AlertCenter.aspx?AID=Red-Flag-Warning-88' }] };
const water: RestrictionCheck = { kind: 'water', state: 'active', alert_count: 1, source_url: WATER_URL, checked_at: CHECKED,
  alerts: [{ title: 'Broomfield is Under a Drought Watch', since_at: '2026-02-09T08:00:00-07:00', url: null }] };

async function render(views: RestrictionView[]): Promise<string> {
  vi.resetModules();
  vi.stubEnv('SITE_CITY', 'broomfield_co');
  vi.doMock('../lib/restrictions-data', () => ({ loadRestrictionViews: async () => views }));
  const { default: C } = await import('./RestrictionStatus.astro');
  return (await AstroContainer.create()).renderToString(C);
}
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('../lib/restrictions-data'); });

const GONE = [/Status unknown/i, /see the source/i, /Not checked yet/i, /Last successful check/i, /data-r-unknown/];

describe('RestrictionStatus: unknown is not rendered (Tillägg C)', () => {
  it('fire known, water unknown (no row at all): only the fire kind is in the HTML', async () => {
    const html = await render([
      restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, NOW),
      restrictionView('water', null, null, { sourceUrl: WATER_URL }, NOW),
    ]);
    expect(html).toContain('Red Flag Warning');
    expect(html).toContain('data-restriction="fire"');
    expect(html).not.toContain('data-restriction="water"');
    expect(html).not.toContain('Water restrictions');
    for (const re of GONE) expect(html).not.toMatch(re);
  });
  it('both unknown (water: the scraper failed-fetch row = state unknown, alerts null; fire: 48 h old): no section at all', async () => {
    const failedWater = { ...water, state: 'unknown' as const, alerts: null, alert_count: null };
    const html = await render([
      restrictionView('fire', fire, fire, { sourceUrl: FIRE_URL }, new Date(Date.parse(CHECKED) + 49 * 3600_000)),
      restrictionView('water', failedWater, water, { sourceUrl: WATER_URL }, NOW),
    ]);
    expect(html).not.toContain('id="restrictions"');
    expect(html.replace(/<script[\s\S]*?<\/script>/g, '').trim()).toBe('');
    for (const re of GONE) expect(html).not.toMatch(re);
  });
});

describe('QA registry (CLAUDE.md 12)', () => {
  it('safety.restriction-unknown-not-rendered is registered with born_from', async () => {
    const { readFileSync } = await import('node:fs');
    const reg = JSON.parse(readFileSync(new URL('../../../qa/checks.json', import.meta.url), 'utf8')).checks as Record<string, { born_from: string }>;
    expect(reg['safety.restriction-unknown-not-rendered']?.born_from).toBeTruthy();
  });
});
