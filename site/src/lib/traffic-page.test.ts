import { afterEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { writeFileSync } from 'node:fs';
import FIX from './fixtures/traffic-rows-2026-11-16.json';

/** Renders the real /traffic/ page (audit Fas 6a, owner 2026-11-16) with the database answers replaced by real rows
 *  (lib/fixtures/traffic-rows-2026-11-16.json). Each case states the read, the build time and what the queries return. */
const db = vi.hoisted(() => ({ run: null as unknown, listed: [] as unknown[], started: [] as unknown[], listedCalls: [] as string[] }));
vi.mock('@neondatabase/serverless', () => ({ neon: () => Object.assign(async () => [], { query: async () => [] }) }));
vi.mock('./db', async (orig) => ({
  ...(await orig<typeof import('./db')>()),
  getTrafficLatestRead: vi.fn(async () => db.run),
  getTrafficIncidentsListedAt: vi.fn(async (readStart: string) => { db.listedCalls.push(readStart); return db.listed; }),
  getTrafficIncidentsStartedSince: vi.fn(async () => db.started),
}));
vi.mock('./traffic-verdict', async (orig) => ({
  ...(await orig<typeof import('./traffic-verdict')>()),
  trafficIndexingForTown: vi.fn(async () => ({ indexable: true })),
}));
vi.mock('./build-checks', async (orig) => ({ ...(await orig<typeof import('./build-checks')>()), runBuildTimeChecks: vi.fn(async () => {}) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const MV = FIX.moreno_valley_ca;
const BF = FIX.broomfield_co;

async function render(town: string, at: string, run: unknown, listed: unknown[], started: unknown[]) {
  Object.assign(db, { run, listed, started, listedCalls: [] });
  vi.useFakeTimers({ now: new Date(at), toFake: ['Date'] });
  vi.resetModules();
  vi.stubEnv('SITE_CITY', town);
  const { default: Page } = await import('../pages/[traffic].astro');
  const page = Page as unknown as Parameters<AstroContainer['renderToString']>[0];
  const html = await (await AstroContainer.create()).renderToString(page, { params: { traffic: 'traffic' } });
  const main = html.slice(html.search(/<h1[\s>]/), html.indexOf('data-about-this-page'));
  const text = main.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1').trim();
  if (process.env.TRAFFIC_RENDER_OUT) writeFileSync(`${process.env.TRAFFIC_RENDER_OUT}/${town}-${at.slice(0, 13)}.txt`, text);
  return { html, text };
}
const rows = (html: string, kind: string) => (html.match(new RegExp(`data-traffic-row="${kind}"`, 'g')) ?? []).length;

describe('/traffic/ when the latest read is out of date', () => {
  it('Moreno Valley, built 17 Nov 20:00 UTC on read #14981 (16 Nov): line, "Last listed" with closures only, no hero', async () => {
    // #4638 (incident) with last_seen_at moved into read #14981, so the read listed an incident next to the two closures.
    const r4638 = { ...MV['4638'], last_seen_at: '2026-11-16 11:25:00.700000+00:00' };
    const { html, text } = await render('moreno_valley_ca', '2026-11-17T20:00:00Z', FIX.runs['14981'], [MV['4448'], MV['4449'], r4638],
      [MV['4565'], MV['4590'], MV['4618'], MV['4622']]);
    expect(db.listedCalls).toEqual(['2026-11-16T11:24:39.853Z']);
    expect(html).not.toContain('data-traffic-hero');
    expect(text).toContain('Not updated since Mon 3:25 AM PST. For conditions now, see Caltrans QuickMap.');
    expect(html).toMatch(/data-traffic-stale[\s\S]*?<a href="https:\/\/quickmap\.dot\.ca\.gov"/);
    expect(text).toContain('Last listed Mon 3:25 AM PST');
    expect(rows(html, 'last-listed')).toBe(2);
    expect(text).toContain('K-rail installation');
    expect(text).toContain('Slide removal');
    expect(text).not.toContain('Traffic Hazard');
    expect(rows(html, 'current')).toBe(0);
    expect(text).not.toContain('refreshed regularly');
    expect(text).toContain('Source: Caltrans QuickMap. State highways');
  });

  it('Broomfield, built 16 Nov 20:00 UTC on read #14912 (15 Nov): line, #4648 last listed, the rest earlier this week', async () => {
    const { html, text } = await render('broomfield_co', '2026-11-16T20:00:00Z', FIX.runs['14912'], [BF['4648']],
      [BF['4537'], BF['4538'], BF['4539'], BF['4598'], BF['4648']]);
    expect(html).not.toContain('data-traffic-hero');
    expect(text).toContain('Not updated since Sun 4:02 AM MST. For conditions now, see CDOT / COtrip.');
    expect(html).toMatch(/data-traffic-stale[\s\S]*?<a href="https:\/\/www\.cotrip\.org"/);
    expect(text).toContain('Last listed Sun 4:02 AM MST');
    expect(rows(html, 'last-listed')).toBe(1);
    expect(rows(html, 'earlier')).toBe(4);
    expect(text).not.toContain('refreshed regularly');
  });

  it('more than 7 days after the read: only the line, with the date', async () => {
    const { html, text } = await render('moreno_valley_ca', '2026-11-23T20:00:00Z', FIX.runs['14981'], [MV['4448'], MV['4449']], []);
    expect(text).toContain('Not updated since Nov 16, 3:25 AM PST. For conditions now, see Caltrans QuickMap.');
    expect(html).not.toContain('data-traffic-last-listed');
    expect(html).not.toContain('data-traffic-hero');
  });
});

describe('/traffic/ without a finished read', () => {
  it('no run: "No data yet", the list query is never asked', async () => {
    const { html, text } = await render('moreno_valley_ca', '2026-11-16T20:00:00Z', null, [MV['4448']], []);
    expect(text).toContain('No data yet. For conditions now, see Caltrans QuickMap.');
    expect(db.listedCalls).toEqual([]);
    expect(html).not.toContain('data-traffic-hero');
  });
  it('a run that started but has not finished (#14981 while running) is not the latest read, for the list or the clock', async () => {
    const running = { ...FIX.runs['14981'], status: 'running', finished_at: null };
    const { html, text } = await render('moreno_valley_ca', '2026-11-16T11:24:50Z', running, [MV['4448']], []);
    expect(db.listedCalls).toEqual([]);
    expect(text).toContain('No data yet. For conditions now, see Caltrans QuickMap.');
    expect(text).not.toMatch(/As of|Not updated since/);
    expect(html).not.toContain('data-traffic-hero');
  });
});

describe('/traffic/ with a fresh read (unchanged)', () => {
  it('Moreno Valley, built 16 Nov 20:00 UTC on read #14981: hero, no out-of-date line, "refreshed regularly"', async () => {
    const { html, text } = await render('moreno_valley_ca', '2026-11-16T20:00:00Z', FIX.runs['14981'], [MV['4448'], MV['4449']], []);
    expect(html).toContain('data-traffic-hero');
    expect(text).toContain('As of 3:25 AM PST');
    expect(html).not.toContain('data-traffic-stale');
    expect(html).not.toContain('data-traffic-last-listed');
    expect(text).toContain('refreshed regularly');
    expect(rows(html, 'current')).toBe(2);
  });
});
