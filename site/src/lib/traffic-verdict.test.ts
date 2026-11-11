// Broomfield AdSense plan F4 (2026-11-11): /traffic/ was indexable with only an H1 and a source line when the feed had nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAFFIC_READ_MAX_AGE_HOURS, trafficPageState } from './traffic-verdict';
import { ALL_CONFIGS } from './site-config';

describe('trafficPageState', () => {
  it('zero incidents: noindex, and one plain line with the time of the latest read', () => {
    const s = trafficPageState(0, 'Broomfield', 'Nov 11, 4:02 AM MST');
    expect(s.noindex).toBe(true);
    expect(s.statusLine).toBe('No crashes or closures reported on state highways in or near Broomfield as of Nov 11, 4:02 AM MST.');
  });

  it('zero incidents and no successful read: still noindex, and the line claims no time', () => {
    expect(trafficPageState(0, 'Broomfield', null)).toEqual({ noindex: true, statusLine: 'No crashes or closures reported on state highways in or near Broomfield.' });
  });

  it('a read older than the limit: says the feed was not read since then, never "nothing reported"', () => {
    expect(trafficPageState(0, 'Broomfield', 'Nov 9, 4:02 AM MST', false, true)).toEqual({
      noindex: true, statusLine: "The state's road feed has not been read since Nov 9, 4:02 AM MST.",
    });
  });

  it('list and status line describe the same read: /traffic/ lists what the latest ok run saw, not a build-time 3 h window', () => {
    // 2026-11-11: a build more than 3 h after a read dropped that read's incidents while the line said "nothing reported as of <read>"
    const page = readFileSync(join(__dirname, '../pages/[traffic].astro'), 'utf8');
    expect(page).toContain('await getTrafficIncidentsFromLatestRead()');
    expect(page).not.toContain('getActiveTrafficIncidents(');
    const db = readFileSync(join(__dirname, 'db.ts'), 'utf8');
    const fn = db.slice(db.indexOf('export async function getTrafficIncidentsFromLatestRead'), db.indexOf('export async function getTrafficLastRun'));
    expect(fn).toContain('last_seen_at >= latest.at');
    expect(fn).toContain(`interval '${TRAFFIC_READ_MAX_AGE_HOURS} hours'`);
  });

  it('incidents: indexable with no status line, unless the town keeps the section quiet', () => {
    expect(trafficPageState(2, 'Broomfield', 'Nov 11, 4:02 AM MST')).toEqual({ noindex: false, statusLine: null });
    expect(trafficPageState(2, 'Brookings', null, true).noindex).toBe(true);
  });

  it('the page takes noindex from this state, and shows no section rule, filters or source line without incidents', () => {
    const page = readFileSync(join(__dirname, '../pages/[traffic].astro'), 'utf8');
    expect(page).toContain('noindex={pageState.noindex}');
    expect(page).toMatch(/\{incidents\.length > 0 && <SectionRule/);
    expect(page).toMatch(/\{siteConfig\.trafficSource && incidents\.length > 0 && \(\s*<p class="source">/);
  });

  it('the source scope notes shown on the page use real punctuation, not " -- "', () => {
    for (const c of ALL_CONFIGS) if (c.trafficSource) expect(c.trafficSource.scopeNote, c.townId).not.toContain('--');
  });
});
